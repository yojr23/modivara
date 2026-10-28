import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RebuildAbortedError, RebuildProjections } from '@modivara/analytics-api';
import { EVENT_HISTORY_READERS, type EventHistoryReader } from '@modivara/core-contracts';
import { serviceCallPageSchema } from '@modivara/hospitality-contracts';
import { startHost } from './testing.js';

// F5-08 (Q-09) de punta a punta: historial real de los outbox de hospitality y commerce → rebuild → mismas tablas. Requiere db-test.
let host: Awaited<ReturnType<typeof startHost>>;
const rebuild = () => host.app.get(RebuildProjections).execute(host.app.get<EventHistoryReader[]>(EVENT_HISTORY_READERS));
// processed_at es la hora del procesamiento: lo único que legítimamente cambia al reconstruir.
const snapshot = async () => ({
  calls: await host.analyticsDb.$queryRawUnsafe<unknown[]>('SELECT * FROM service_call_facts ORDER BY service_call_id'),
  stocks: await host.analyticsDb.$queryRawUnsafe<unknown[]>('SELECT * FROM stock_movement_facts ORDER BY movement_id'),
  processed: await host.analyticsDb.$queryRawUnsafe<unknown[]>('SELECT event_id, event_type FROM processed_events ORDER BY event_id'),
});

beforeAll(async () => {
  host = await startHost();
  const { as, locationId } = host;
  await host.press();
  const [active] = serviceCallPageSchema.parse((await as('bar-demo/barra').get(`/locations/${locationId}/service-calls`)).body).items;
  const base = `/locations/${locationId}/service-calls/${active!.id}`;
  await as('bar-demo/barra').post(`${base}/acknowledge`);
  await as('bar-demo/barra').post(`${base}/complete`);
  const inv = as('bar-demo/inventario1');
  const products = (await inv.get(`/locations/${locationId}/products`)).body as Array<{ id: string; name: string }>;
  const places = (await inv.get(`/locations/${locationId}/stock-locations`)).body as Array<{ id: string }>;
  const reasons = (await inv.get('/commerce/movement-reasons')).body as Array<{ id: string; name: string }>;
  const reason = (name: string) => reasons.find((r) => r.name === name)!.id;
  const beer = products.find((p) => p.name === 'Cerveza')!.id;
  const key = () => ({ 'idempotency-key': crypto.randomUUID() });
  const move = (direction: string, reasonName: string, quantity: string) =>
    inv.post(`/locations/${locationId}/stock/movements`, { stock_location_id: places[0]!.id, product_id: beer, direction, reason_id: reason(reasonName), quantity }, key());
  await move('in', 'Compra', '10');
  await move('out', 'Venta', '4.5');
  await inv.post(`/locations/${locationId}/stock/count-adjustments`, { stock_location_id: places[0]!.id, product_id: beer, reason_id: reason('Corrección de conteo'), counted_quantity: '50' }, key());
  await host.tickHospitality();
  await host.tickCommerce();
});
afterAll(() => host.app.close());

describe('analytics:rebuild', () => {
  it('reconstruir sobre una proyección en vivo deja las tablas idénticas', async () => {
    const before = await snapshot();
    expect(before.calls).toHaveLength(1);
    expect(before.stocks.length).toBeGreaterThanOrEqual(3);
    const summary = await rebuild();
    expect(summary).toMatchObject({ duplicates: 0, applied: before.processed.length });
    expect(await snapshot()).toEqual(before);
  });

  it('recupera eventos ya despachados que analytics no tenía (despachados antes de suscribirse)', async () => {
    const before = await snapshot();
    await host.analyticsDb.$executeRawUnsafe('TRUNCATE processed_events, service_call_facts, stock_movement_facts');
    expect((await snapshot()).processed).toHaveLength(0);
    await rebuild();
    expect(await snapshot()).toEqual(before);
  });

  it('un evento inválido en el historial aborta, informa su event_id y deja intacta la proyección anterior', async () => {
    const before = await snapshot();
    const eventId = crypto.randomUUID();
    await host.hospitalityDb.$executeRawUnsafe(`
      INSERT INTO outbox_events (id, event_type, event_version, occurred_at, organization_id, location_id, aggregate_id, correlation_id, payload, dispatched_at)
      VALUES ('${eventId}', 'hospitality.service_call.created', 1, now() + interval '1 day', '${host.organizationId}', '${host.locationId}', '${crypto.randomUUID()}', '${crypto.randomUUID()}', '{"service_call_id": "x"}', now())`);
    const error = await rebuild().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RebuildAbortedError);
    expect((error as RebuildAbortedError).eventId).toBe(eventId);
    expect(await snapshot()).toEqual(before);
  });
});
