import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsModule } from '@modivara/analytics-api';
import { ANALYTICS_API_PATHS as P, inventoryMetricsSchema, serviceCallMetricsSchema } from '@modivara/analytics-contracts';
import { COMMERCE_OUTBOX, CommerceModule } from '@modivara/commerce-api';
import { CORE_PRISMA } from '@modivara/core-api';
import { INTEGRATION_EVENT_SUBSCRIBERS } from '@modivara/core-contracts';
import { HOST_TIMEOUT, MANUAL, type Raw, startPartialHost } from './partial-host.js';

// PLAN-003 T05: host Core + Commerce + Analytics, sin Hospitality (ni variable, ni módulo, ni esquema).
let host: Awaited<ReturnType<typeof startPartialHost>>;
beforeAll(async () => {
  host = await startPartialHost('modivara_core_commerce_analytics', ['commerce', 'analytics'], (url) => [
    CommerceModule.forRoot({ databaseUrl: url('commerce'), ...MANUAL }),
    AnalyticsModule.forRoot({ databaseUrl: url('analytics') }),
  ]);
}, HOST_TIMEOUT);
afterAll(() => host?.close());

describe('T05 host Core + Commerce + Analytics (sin Hospitality)', () => {
  it('no instancia providers ni consumidores de Hospitality y la base no tiene su esquema', async () => {
    for (const token of ['HOSPITALITY_PRISMA', 'HOSPITALITY_OUTBOX', 'HOSPITALITY_EVENT_SUBSCRIBER']) expect(() => host.get(token)).toThrow();
    expect(host.get<Array<{ name: string }>>(INTEGRATION_EVENT_SUBSCRIBERS).map((s) => s.name))
      .toEqual(['core.platform-action-audit', 'commerce.location-created', 'analytics']);
    const schemas = await host.get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ nspname: string }>>(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('core', 'commerce', 'hospitality', 'analytics') ORDER BY nspname",
    );
    expect(schemas.map((s) => s.nspname)).toEqual(['analytics', 'commerce', 'core']);
  });

  it('un movimiento de commerce llega a métricas de inventario tras el tick del outbox; las de llamados quedan en cero sin error', async () => {
    const { locationId } = await host.provision('tienda', ['commerce', 'analytics'], { inventario: 'inventory', admin: 'admin' });
    await host.tickCore(); // core.location.created → commerce siembra motivos y «Principal»
    const inv = host.as(await host.login('tienda', 'inventario'));
    const product = await inv.post(`/locations/${locationId}/products`, { name: 'Camiseta M', sku: 'CAM-M', unit: 'unit' });
    const [place] = (await inv.get(`/locations/${locationId}/stock-locations`)).body as Array<{ id: string }>;
    const compra = ((await inv.get('/commerce/movement-reasons')).body as Array<{ id: string; name: string }>).find((r) => r.name === 'Compra')!;
    expect((await inv.post(`/locations/${locationId}/stock/movements`, {
      stock_location_id: place!.id, product_id: product.body.id, direction: 'in', reason_id: compra.id, quantity: '7',
    }, { 'Idempotency-Key': crypto.randomUUID() })).status).toBe(201);

    const inventory = async () => {
      const res = await inv.get(`${P.inventoryMetrics.replace(':locationId', locationId)}?range=today`);
      expect(res.status).toBe(200);
      return inventoryMetricsSchema.parse(res.body);
    };
    expect((await inventory()).balances).toEqual([]); // aún sin despachar
    await host.get<{ tick(): Promise<number> }>(COMMERCE_OUTBOX).tick();
    const metrics = await inventory();
    expect(metrics.by_direction.find((d) => d.direction === 'in')).toEqual({ direction: 'in', movement_count: 1, total_delta: '7.000' });
    expect(metrics.balances.map((b) => [b.product_id, Number(b.balance)])).toEqual([[product.body.id, 7]]);

    const calls = await host.as(await host.login('tienda', 'admin')).get(`${P.serviceCallMetrics.replace(':locationId', locationId)}?range=today`);
    expect(calls.status).toBe(200);
    const body = serviceCallMetricsSchema.parse(calls.body);
    expect([body.totals.calls, body.by_table, body.by_zone]).toEqual([0, [], []]);
  });
});
