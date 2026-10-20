import { z } from 'zod';
import { groupBySchema } from './query.js';

const instant = z.iso.datetime({ offset: true });
const count = z.number().int().min(0);
/** Cantidad NUMERIC(12,3) como string decimal con signo; nunca number. */
const decimal = z.string().regex(/^-?\d+\.\d{3}$/);

const periodBucket = { bucket_start: instant, bucket_label: z.string() };
const durationStats = z.object({
  count,
  average_seconds: z.number().nullable(),
  median_seconds: z.number().nullable(),
});

/**
 * Métricas de llamados. «Atendida» es un cierre registrado por el personal; los tiempos son
 * `acknowledged_at − created_at` y `completed_at − created_at`: no prueban llegada física (TECH-001 §8).
 */
export const serviceCallMetricsSchema = z.object({
  timezone: z.string(),
  from: instant,
  to: instant,
  group_by: groupBySchema,
  totals: z.object({
    calls: count,
    pending: count,
    in_progress: count,
    completed: count,
    repeated_presses: count,
    calls_with_repeated_presses: count,
  }),
  time_to_acknowledge: durationStats,
  time_to_complete: durationStats,
  by_table: z.array(
    z.object({ table_id: z.uuid(), table_label: z.string(), zone_id: z.uuid().nullable(), zone_name: z.string().nullable(), calls: count }),
  ),
  by_zone: z.array(z.object({ zone_id: z.uuid().nullable(), zone_name: z.string().nullable(), calls: count })),
  by_period: z.array(z.object({ ...periodBucket, calls: count })),
});
export type ServiceCallMetrics = z.infer<typeof serviceCallMetricsSchema>;

const direction = z.enum(['in', 'out', 'adjust']);

/** Métricas de inventario. `*_delta` va con signo (salidas negativas); `balance` es el último saldo conocido. */
export const inventoryMetricsSchema = z.object({
  timezone: z.string(),
  from: instant,
  to: instant,
  group_by: groupBySchema,
  by_direction: z.array(z.object({ direction, movement_count: count, total_delta: decimal })),
  by_reason: z.array(
    z.object({ direction, reason_id: z.uuid(), reason_name: z.string(), movement_count: count, total_delta: decimal }),
  ),
  by_period: z.array(
    z.object({ ...periodBucket, movement_count: count, in_delta: decimal, out_delta: decimal, adjust_delta: decimal }),
  ),
  balances: z.array(
    z.object({ stock_location_id: z.uuid(), product_id: z.uuid(), product_name: z.string(), balance: decimal, as_of: instant }),
  ),
});
export type InventoryMetrics = z.infer<typeof inventoryMetricsSchema>;
