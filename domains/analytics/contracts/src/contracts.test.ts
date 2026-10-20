import { describe, expect, it } from 'vitest';
import {
  inventoryMetricsQuerySchema,
  inventoryMetricsSchema,
  serviceCallMetricsQuerySchema,
  serviceCallMetricsSchema,
} from './index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('consultas', () => {
  it('group_by vale day por defecto y acepta atajos', () => {
    expect(serviceCallMetricsQuerySchema.parse({ range: 'today' }).group_by).toBe('day');
    expect(serviceCallMetricsQuerySchema.safeParse({ range: 'last_7_days', group_by: 'hour' }).success).toBe(true);
  });
  it('rechaza atajo desconocido y group_by inválido', () => {
    expect(serviceCallMetricsQuerySchema.safeParse({ range: 'last_year' }).success).toBe(false);
    expect(serviceCallMetricsQuerySchema.safeParse({ range: 'today', group_by: 'week' }).success).toBe(false);
  });
  it('custom exige from y to ordenados y con fecha real', () => {
    const q = (extra: object) => serviceCallMetricsQuerySchema.safeParse({ range: 'custom', ...extra }).success;
    expect(q({})).toBe(false);
    expect(q({ from: '2026-10-01' })).toBe(false);
    expect(q({ from: '2026-10-02', to: '2026-10-01' })).toBe(false);
    expect(q({ from: '2026-02-30', to: '2026-03-01' })).toBe(false);
    expect(q({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
  });
  it('from/to sin custom se rechazan', () => {
    expect(serviceCallMetricsQuerySchema.safeParse({ range: 'today', from: '2026-10-01', to: '2026-10-02' }).success).toBe(false);
  });
  it('filtros por zona y mesa deben ser uuid', () => {
    expect(serviceCallMetricsQuerySchema.safeParse({ range: 'today', zone_id: uuid(1), table_id: uuid(2) }).success).toBe(true);
    expect(serviceCallMetricsQuerySchema.safeParse({ range: 'today', zone_id: 'terraza' }).success).toBe(false);
    expect(inventoryMetricsQuerySchema.safeParse({ range: 'yesterday', product_id: uuid(3), stock_location_id: uuid(4) }).success).toBe(true);
  });
});

describe('respuestas', () => {
  const stats = { count: 0, average_seconds: null, median_seconds: null };
  it('acepta métricas de llamados vacías', () => {
    const body = {
      timezone: 'America/Bogota',
      from: '2026-10-19T05:00:00.000Z',
      to: '2026-10-20T05:00:00.000Z',
      group_by: 'day',
      totals: { calls: 0, pending: 0, in_progress: 0, completed: 0, repeated_presses: 0, calls_with_repeated_presses: 0 },
      time_to_acknowledge: stats,
      time_to_complete: stats,
      by_table: [],
      by_zone: [],
      by_period: [],
    };
    expect(serviceCallMetricsSchema.safeParse(body).success).toBe(true);
    expect(serviceCallMetricsSchema.safeParse({ ...body, totals: { ...body.totals, calls: -1 } }).success).toBe(false);
  });
  it('las cantidades de inventario son string decimal, no number', () => {
    const body = {
      timezone: 'America/Bogota',
      from: '2026-10-19T05:00:00.000Z',
      to: '2026-10-20T05:00:00.000Z',
      group_by: 'day',
      by_direction: [{ direction: 'out', movement_count: 1, total_delta: '-2.500' }],
      by_reason: [],
      by_period: [],
      balances: [{ stock_location_id: uuid(1), product_id: uuid(2), product_name: 'Ron', balance: '7.500', as_of: '2026-10-19T10:00:00.000Z' }],
    };
    expect(inventoryMetricsSchema.safeParse(body).success).toBe(true);
    expect(inventoryMetricsSchema.safeParse({ ...body, balances: [{ ...body.balances[0], balance: 7.5 }] }).success).toBe(false);
  });
});
