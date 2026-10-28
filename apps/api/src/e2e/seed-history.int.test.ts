import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_API_PATHS as P, inventoryMetricsSchema, serviceCallMetricsSchema } from '@modivara/analytics-contracts';
import type { BalanceDto } from '@modivara/commerce-contracts';
import { seedHistory } from '../seed/history.js';
import { seedHospitality } from '../seed/hospitality.js';
import { PASSWORD, startHost } from './testing.js';

// F5-10: el historial lo escribe cada dominio dueño (filas reales + outbox v1) y analytics lo recibe por el camino normal.
let host: Awaited<ReturnType<typeof startHost>>;
beforeAll(async () => { host = await startHost(); });
afterAll(() => host.app.close());

const drain = async () => { while ((await host.tickHospitality()) + (await host.tickCommerce()) > 0); };
const count = async (db: { $queryRawUnsafe<T>(sql: string): Promise<T> }, table: string) =>
  Number((await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM ${table}`))[0]!.n);

describe('F5-10 seed histórico', () => {
  it('14 días de métricas en Bar Demo, idempotente y con saldos de analytics = commerce', async () => {
    const { app, as, locationId, hospitalityDb, analyticsDb } = host;
    await seedHospitality(app, PASSWORD, () => {});
    const first = await seedHistory(app, PASSWORD);
    expect(first.calls).toBeGreaterThan(14 * 15);
    expect(first.movements).toBeGreaterThan(14 * 10);
    await drain();

    const calls = serviceCallMetricsSchema.parse((await as('bar-demo/admin').get(P.serviceCallMetrics.replace(':locationId', locationId) + '?range=last_30_days&group_by=day')).body);
    expect(calls.totals).toMatchObject({ calls: first.calls, completed: first.calls, pending: 0, in_progress: 0 });
    expect(calls.by_period.filter((b) => b.calls > 0)).toHaveLength(14);
    expect(calls.by_period).toHaveLength(30); // last_30_days con los días sin llamados en 0 (hoy incluido)
    expect(calls.by_table).toHaveLength(15);
    expect(calls.time_to_acknowledge.average_seconds).toBeGreaterThan(60);
    expect(calls.time_to_acknowledge.average_seconds).toBeLessThan(240);
    expect(calls.totals.calls_with_repeated_presses).toBeGreaterThan(0);

    const inv = inventoryMetricsSchema.parse((await as('bar-demo/admin').get(P.inventoryMetrics.replace(':locationId', locationId) + '?range=last_30_days&group_by=day')).body);
    expect(inv.by_period.length).toBeGreaterThanOrEqual(14);
    expect(inv.by_direction.map((d) => d.direction).sort()).toEqual(['adjust', 'in', 'out']);
    const balances = (await as('bar-demo/inventario1').get(`/locations/${locationId}/stock/balances`)).body as BalanceDto[];
    expect(inv.balances).toHaveLength(balances.length);
    for (const b of balances) {
      expect(Number(inv.balances.find((x) => x.product_id === b.product_id)!.balance)).toBe(Number(b.quantity));
      expect(Number(b.quantity)).toBeGreaterThanOrEqual(0);
    }

    // Segunda corrida: nada cambia (ni en los dominios ni en analytics).
    const before = [await count(hospitalityDb, 'service_calls'), await count(hospitalityDb, 'device_events'), await count(hospitalityDb, 'outbox_events'), await count(analyticsDb, 'service_call_facts'), await count(analyticsDb, 'stock_movement_facts')];
    await seedHospitality(app, PASSWORD, () => {});
    expect(await seedHistory(app, PASSWORD)).toEqual({ calls: 0, movements: 0 });
    await drain();
    expect([await count(hospitalityDb, 'service_calls'), await count(hospitalityDb, 'device_events'), await count(hospitalityDb, 'outbox_events'), await count(analyticsDb, 'service_call_facts'), await count(analyticsDb, 'stock_movement_facts')]).toEqual(before);
  }, 120_000);
});
