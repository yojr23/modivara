import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_PRISMA } from '@modivara/core-api';
import { INTEGRATION_EVENT_SUBSCRIBERS, type IntegrationEvent } from '@modivara/core-contracts';
import { POS_OUTBOX } from '@modivara/pos-api';
import { IDEMPOTENCY_KEY_HEADER, POS_EVENT_HISTORY, saleCompletedV1, saleResultSchema, sellableItemSchema } from '@modivara/pos-contracts';
import { domainModules, selectedDomains } from '../domains.js';
import { HOST_TIMEOUT, type Raw, startPartialHost } from './partial-host.js';

// INV-02 / QA-01: Core + POS con el host REAL (domainModules(selectedDomains('pos'))) sobre una base propia que físicamente NO tiene
// los esquemas hospitality, commerce ni analytics, y sin sus variables de entorno. Si POS dependiera de alguno, no arrancaría.
const FOREIGN = ['hospitality', 'commerce', 'analytics'];
const ENV_KEEP = ['POS_DATABASE_URL', 'OUTBOX_POLL_INTERVAL_MS'].map((k) => [k, process.env[k]] as const);
let host: Awaited<ReturnType<typeof startPartialHost>>;
const key = () => ({ [IDEMPOTENCY_KEY_HEADER]: crypto.randomUUID() });

beforeAll(async () => {
  host = await startPartialHost('modivara_core_pos', ['pos'], (url) => {
    process.env.POS_DATABASE_URL = url('pos');
    process.env.OUTBOX_POLL_INTERVAL_MS = '3600000'; // sin poller en segundo plano: el despacho se prueba con tick()
    return domainModules(selectedDomains('pos'));
  });
}, HOST_TIMEOUT);
afterAll(async () => {
  await host?.close();
  for (const [k, v] of ENV_KEEP) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

describe('INV-02 host Core + POS aislado (sin esquemas ni variables de otros dominios)', () => {
  it('la base solo tiene core y pos; el entorno no trae URLs de otros dominios; no hay providers ajenos', async () => {
    // pg_namespace (no information_schema.schemata): este último solo lista los esquemas a los que el rol tiene acceso.
    const rows = await host.get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ nspname: string }>>(
      `SELECT nspname FROM pg_namespace WHERE nspname IN ('core','pos','hospitality','commerce','analytics')`);
    expect(rows.map((r) => r.nspname).sort()).toEqual(['core', 'pos']);
    for (const d of FOREIGN) {
      expect(process.env[`${d.toUpperCase()}_DATABASE_URL`]).toBeUndefined();
      expect(() => host.get(`${d.toUpperCase()}_PRISMA`)).toThrow();
    }
    expect(host.get<Array<{ name: string }>>(INTEGRATION_EVENT_SUBSCRIBERS).map((s) => s.name)).not.toEqual(expect.arrayContaining([expect.stringMatching(/hospitality|commerce|analytics/)]));
  });

  it('/health/live y /health/ready responden 200', async () => {
    expect((await request(host.origin).get('/api/v1/health/live')).status).toBe(200);
    const ready = await request(host.origin).get('/api/v1/health/ready');
    expect([ready.status, ready.body]).toEqual([200, { status: 'ok', database: 'up' }]);
  });

  it('negocio solo con POS: login, artículo, venta, cierre con cobro declarado, historial y evento sin consumidores', async () => {
    const { locationId } = await host.provision('tienda-sola', ['pos'], { admin: 'admin', caja: 'cashier' });
    const admin = host.as(await host.login('tienda-sola', 'admin'));
    const caja = host.as(await host.login('tienda-sola', 'caja'));
    expect((await caja.get('/me')).body.organization.slug).toBe('tienda-sola');
    const base = `/locations/${locationId}/pos`;

    const created = await admin.post(`${base}/items`, { name: 'Tenis negro 42', sku: 'ZAP-NEG-42', unit: 'unit', price: '189900' });
    expect(created.status).toBe(201);
    const item = sellableItemSchema.parse(created.body);
    const opened = await caja.post(`${base}/sales`, undefined, key());
    expect(opened.status).toBe(201);
    const saleId = saleResultSchema.parse(opened.body).sale.id;
    expect((await caja.post(`${base}/sales/${saleId}/lines`, { sellable_item_id: item.id, quantity: '2' }, key())).status).toBe(201);
    const done = await caja.post(`${base}/sales/${saleId}/complete`, { payment_method: 'card' }, key());
    expect(done.status).toBe(201);
    expect(saleResultSchema.parse(done.body).sale).toMatchObject({ status: 'completed', total: '379800.00' });
    expect((await caja.get(`${base}/sales?status=completed`)).body).toHaveLength(1);

    const events: IntegrationEvent[] = [];
    for await (const e of host.get<{ read(): AsyncIterable<IntegrationEvent> }>(POS_EVENT_HISTORY).read()) events.push(e);
    expect(events).toHaveLength(1);
    expect(saleCompletedV1.parse(events[0])).toMatchObject({
      event_type: 'pos.sale.completed', aggregate_id: saleId, location_id: locationId, payload: { total: '379800.00', payment_method: 'card' },
    });
    // Sin suscriptores de POS, el poller lo despacha igual (y queda sin pendientes ni fallidos).
    expect(await host.get<{ tick(): Promise<number> }>(POS_OUTBOX).tick()).toBe(1);
    expect(await host.get<{ tick(): Promise<number> }>(POS_OUTBOX).tick()).toBe(0);
    expect(await host.get<{ countFailed(): Promise<number> }>(POS_OUTBOX).countFailed()).toBe(0);

    // Sin Hospitality en el host no hay validador de mesas: vincular a un proveedor ausente es 404.
    const link = await caja.post(`${base}/links`, { provider: 'hospitality', resource_type: 'table', resource_id: crypto.randomUUID() }, key());
    expect(link.status).toBe(404);
  });

  it('MODIVARA_DOMAINS con un dominio desconocido detiene el arranque', () => {
    expect(selectedDomains('pos')).toEqual(['pos']);
    expect(() => selectedDomains('pos,inexistente')).toThrow(/dominio desconocido "inexistente"/);
  });
});
