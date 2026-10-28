import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetInventoryMetrics } from '@modivara/analytics-api';
import type { BalanceDto, MovementDto } from '@modivara/commerce-contracts';
import { serviceCallPageSchema, serviceCallSchema, type ServiceCallDto } from '@modivara/hospitality-contracts';
import { startHost } from './testing.js';

// F5-03 / F5-04 de punta a punta: acción en el dominio emisor → su outbox → tick() → proyección de analytics. Requiere db-test.
let host: Awaited<ReturnType<typeof startHost>>;
beforeAll(async () => { host = await startHost(); });
afterAll(() => host.app.close());

describe('llamados: hospitality → analytics', () => {
  it('pulsar, reconocer y finalizar dejan un fact con los tiempos y el press_count finales', async () => {
    const { as, locationId } = host;
    expect((await host.press()).status).toBe(200);
    const [active] = serviceCallPageSchema.parse((await as('bar-demo/barra').get(`/locations/${locationId}/service-calls`)).body).items;
    const base = `/locations/${locationId}/service-calls/${active!.id}`;
    expect((await as('bar-demo/barra').post(`${base}/acknowledge`)).status).toBe(200);
    const done = serviceCallSchema.parse((await as('bar-demo/barra').post(`${base}/complete`)).body);

    expect(await host.tickHospitality()).toBe(3);
    const facts = await host.analyticsDb.$queryRawUnsafe<Array<{ created_at: Date; acknowledged_at: Date; completed_at: Date; press_count: number; table_label: string }>>(
      'SELECT created_at, acknowledged_at, completed_at, press_count, table_label FROM service_call_facts',
    );
    expect(facts).toHaveLength(1);
    const f = facts[0]!;
    const expected: ServiceCallDto = done;
    expect([f.created_at, f.acknowledged_at, f.completed_at].map((d) => d.getTime())).toEqual(
      [expected.created_at, expected.acknowledged_at!, expected.completed_at!].map((d) => new Date(d).getTime()),
    );
    expect(f.press_count).toBe(done.press_count);
    expect(f.table_label).toBe('1');
    expect(await host.hospitalityDb.$queryRawUnsafe('SELECT 1 FROM outbox_events WHERE dispatched_at IS NULL')).toHaveLength(0);
  });
});

describe('inventario: commerce → analytics', () => {
  it('in/out/adjust llegan como facts y el saldo actual es el último balance_after por (lugar, producto)', async () => {
    const { as, locationId, organizationId } = host;
    const inv = as('bar-demo/inventario1');
    const products = (await inv.get(`/locations/${locationId}/products`)).body as Array<{ id: string; name: string }>;
    const places = (await inv.get(`/locations/${locationId}/stock-locations`)).body as Array<{ id: string }>;
    const reasons = (await inv.get('/commerce/movement-reasons')).body as Array<{ id: string; name: string }>;
    const reason = (name: string) => reasons.find((r) => r.name === name)!.id;
    const beer = products.find((p) => p.name === 'Cerveza')!.id;
    const rum = products.find((p) => p.name === 'Ron')!.id;
    const move = (product: string, direction: string, reasonName: string, quantity: string) =>
      inv.post(`/locations/${locationId}/stock/movements`, { stock_location_id: places[0]!.id, product_id: product, direction, reason_id: reason(reasonName), quantity }, { 'idempotency-key': crypto.randomUUID() });

    expect((await move(beer, 'in', 'Compra', '10')).status).toBe(201);
    expect((await move(beer, 'out', 'Venta', '4.5')).status).toBe(201);
    expect((await move(rum, 'out', 'Merma', '1')).status).toBe(201);
    const adj = await inv.post(`/locations/${locationId}/stock/count-adjustments`, { stock_location_id: places[0]!.id, product_id: beer, reason_id: reason('Corrección de conteo'), counted_quantity: '50' }, { 'idempotency-key': crypto.randomUUID() });
    expect(adj.status).toBe(201);

    await host.tickCommerce();
    const movements = (await inv.get(`/locations/${locationId}/stock/movements?limit=200`)).body as MovementDto[];
    const facts = await host.analyticsDb.$queryRawUnsafe<Array<{ direction: string }>>(`SELECT direction FROM stock_movement_facts WHERE location_id = '${locationId}'`);
    expect(facts).toHaveLength(movements.length); // incluye las entradas iniciales del seed
    expect(new Set(facts.map((r) => r.direction))).toEqual(new Set(['in', 'out', 'adjust']));

    const metrics = await host.app.get(GetInventoryMetrics, { strict: false }).execute({
      organizationId, locationId, query: { range: 'today', group_by: 'day' },
    });
    const balances = (await inv.get(`/locations/${locationId}/stock/balances`)).body as BalanceDto[];
    expect(metrics.balances).toHaveLength(balances.length);
    for (const b of balances) {
      const m = metrics.balances.find((x) => x.product_id === b.product_id && x.stock_location_id === b.stock_location_id)!;
      expect(Number(m.balance)).toBe(Number(b.quantity));
    }
    expect(Number(metrics.balances.find((x) => x.product_id === beer)!.balance)).toBe(50);
  });
});
