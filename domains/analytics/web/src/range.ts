import { RANGE_PRESETS, type GroupBy, type RangePreset } from '@modivara/analytics-contracts';

export { RANGE_PRESETS };

/**
 * Estado del selector de rango. El servidor resuelve el atajo en la zona horaria del local:
 * el cliente solo envía el atajo (y `from`/`to`, fechas locales `YYYY-MM-DD`, con `custom`).
 */
export interface RangeSelection {
  preset: RangePreset;
  from?: string;
  to?: string;
  groupBy?: GroupBy;
  /** Filtros opcionales ya en snake_case (`zone_id`, `table_id`, `product_id`, `stock_location_id`); los vacíos se omiten. */
  filters?: Record<string, string | undefined>;
}

export type QueryResult = { ok: true; query: Record<string, string> } | { ok: false; error: 'custom_requires_dates' | 'custom_range_reversed' };

/** Parámetros de consulta listos para la API; `custom` exige `from` y `to` (from <= to). */
export function toMetricsQuery(s: RangeSelection): QueryResult {
  const query: Record<string, string> = { range: s.preset };
  if (s.preset === 'custom') {
    if (!s.from || !s.to) return { ok: false, error: 'custom_requires_dates' };
    if (s.from > s.to) return { ok: false, error: 'custom_range_reversed' };
    query.from = s.from;
    query.to = s.to;
  }
  if (s.groupBy) query.group_by = s.groupBy;
  for (const [k, v] of Object.entries(s.filters ?? {})) if (v) query[k] = v;
  return { ok: true, query };
}
