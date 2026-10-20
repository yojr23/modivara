import { z } from 'zod';

/** Atajos de rango (TECH-001 §16.9). Se resuelven en la zona horaria del local, no en la del servidor. */
export const RANGE_PRESETS = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'custom'] as const;
export const rangePresetSchema = z.enum(RANGE_PRESETS);
export type RangePreset = z.infer<typeof rangePresetSchema>;

/** Agrupación por hora o día en la zona horaria del local. */
export const GROUP_BYS = ['hour', 'day'] as const;
export const groupBySchema = z.enum(GROUP_BYS);
export type GroupBy = z.infer<typeof groupBySchema>;

// OPEN: ¿`from`/`to` de `custom` son fechas locales del local (ambas inclusivas, como aquí) o instantes UTC?
const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'Fecha inválida');

const rangeShape = {
  range: rangePresetSchema,
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  group_by: groupBySchema.default('day'),
};

type RangeInput = { range: RangePreset; from?: string | undefined; to?: string | undefined };

/** `custom` exige from y to (from <= to); los demás atajos no los admiten. */
function checkCustomRange(q: RangeInput, ctx: z.RefinementCtx): void {
  if (q.range === 'custom') {
    if (!q.from) ctx.addIssue({ code: 'custom', path: ['from'], message: 'custom exige from' });
    if (!q.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'custom exige to' });
    if (q.from && q.to && q.from > q.to) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to debe ser >= from' });
  } else if (q.from || q.to) {
    ctx.addIssue({ code: 'custom', path: ['range'], message: 'from/to solo aplican con range=custom' });
  }
}

/** Consulta de métricas de llamados: filtros opcionales por zona y mesa. Sin exportación en el MVP. */
export const serviceCallMetricsQuerySchema = z
  .object({ ...rangeShape, zone_id: z.uuid().optional(), table_id: z.uuid().optional() })
  .superRefine(checkCustomRange);
export type ServiceCallMetricsQuery = z.infer<typeof serviceCallMetricsQuerySchema>;

/** Consulta de métricas de inventario: filtros opcionales por producto y lugar de stock. */
export const inventoryMetricsQuerySchema = z
  .object({ ...rangeShape, product_id: z.uuid().optional(), stock_location_id: z.uuid().optional() })
  .superRefine(checkCustomRange);
export type InventoryMetricsQuery = z.infer<typeof inventoryMetricsQuerySchema>;
