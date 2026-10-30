import { inventoryMetricsSchema, serviceCallMetricsSchema } from '@modivara/analytics-contracts';
import { movementSchema } from '@modivara/commerce-contracts';
import { describe, expect, it } from 'vitest';
import { MOVEMENTS, PRODUCTS, balancesOf, inventoryMetrics, serviceCallMetrics } from './demo-data';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('datos de demo de los prototipos', () => {
  it('las métricas de llamados cumplen el contrato y sus totales cuadran', () => {
    for (const range of ['today', 'yesterday', 'last_7_days', 'last_30_days'] as const) {
      const m = serviceCallMetricsSchema.parse(serviceCallMetrics({ range }));
      expect(sum(m.by_table.map((t) => t.calls))).toBe(m.totals.calls);
      expect(sum(m.by_zone.map((z) => z.calls))).toBe(m.totals.calls);
      expect(sum(m.by_period.map((p) => p.calls))).toBe(m.totals.calls);
      expect(m.totals.pending + m.totals.in_progress + m.totals.completed).toBe(m.totals.calls);
    }
    expect(serviceCallMetrics({ range: 'last_7_days' }).totals.calls).toBeGreaterThan(100);
  });

  it('los movimientos cumplen el contrato, el saldo nunca es negativo y balance_after sigue la suma de deltas', () => {
    for (const mv of MOVEMENTS) movementSchema.parse(mv);
    for (const p of PRODUCTS) {
      const mine = MOVEMENTS.filter((m) => m.product_id === p.id).reverse();
      let running = 0;
      for (const m of mine) {
        running += Number(m.delta);
        expect(Number(m.balance_after)).toBeCloseTo(running, 3);
        expect(running).toBeGreaterThanOrEqual(0);
      }
      expect(balancesOf(MOVEMENTS).get(p.id)).toBeCloseTo(running, 3);
    }
    const inv = inventoryMetricsSchema.parse(inventoryMetrics({ range: 'last_7_days' }));
    expect(sum(inv.by_period.map((b) => b.movement_count))).toBe(sum(inv.by_direction.map((d) => d.movement_count)));
  });
});
