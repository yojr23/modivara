import type { CallStatus } from '@modivara/hospitality-contracts';
import type { GroupBy, ServiceCallMetrics } from '@modivara/analytics-contracts';
import type { DateRange } from './date-range.js';
import type { ServiceCallFact } from './service-call-fact.js';
import { bucketOf, bucketsBetween } from './time-zone.js';

/** `now` limita el relleno de cubetas vacías (por defecto, el reloj). */
export interface MetricsCtx {
  timeZone: string;
  groupBy: GroupBy;
  range: DateRange;
  now?: Date | undefined;
}

export interface DurationStats {
  count: number;
  average_seconds: number | null;
  median_seconds: number | null;
}

export function durationStats(valuesMs: readonly number[]): DurationStats {
  if (valuesMs.length === 0) return { count: 0, average_seconds: null, median_seconds: null };
  const sorted = [...valuesMs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const average = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return { count: sorted.length, average_seconds: average / 1000, median_seconds: median / 1000 };
}

/** Cuenta por clave conservando el primer valor visto para la clave. */
function tally<T>(items: readonly T[], key: (t: T) => string): Map<string, { sample: T; calls: number }> {
  const out = new Map<string, { sample: T; calls: number }>();
  for (const it of items) {
    const k = key(it);
    const cur = out.get(k);
    if (cur) cur.calls++;
    else out.set(k, { sample: it, calls: 1 });
  }
  return out;
}

// ponytail: agrega en memoria; techo = volumen del piloto. Pasar a `date_trunc` en SQL (DATA-001 §5) al crecer.
function periods(facts: readonly ServiceCallFact[], ctx: MetricsCtx) {
  const out = new Map<string, { bucket_start: string; bucket_label: string; calls: number }>();
  // Cubetas vacías con 0 hasta la actual, para que el front grafique sin rellenar.
  for (const b of bucketsBetween(ctx.range.from, ctx.range.to, ctx.groupBy, ctx.timeZone, ctx.now ?? new Date())) {
    out.set(b.label, { bucket_start: b.start.toISOString(), bucket_label: b.label, calls: 0 });
  }
  for (const f of facts) {
    const b = bucketOf(f.snapshot.createdAt, ctx.groupBy, ctx.timeZone); // una vez por fact
    const p = out.get(b.label);
    if (p) p.calls++;
    else out.set(b.label, { bucket_start: b.start.toISOString(), bucket_label: b.label, calls: 1 });
  }
  return [...out.values()].sort((a, b) => a.bucket_start.localeCompare(b.bucket_start));
}

/**
 * Cálculo puro. `facts` ya viene filtrado por local y periodo (created_at); aquí se agrupa.
 * «Atendida» = cierre registrado por el personal, no prueba física.
 */
export function computeServiceCallMetrics(
  facts: readonly ServiceCallFact[],
  ctx: MetricsCtx,
): ServiceCallMetrics {
  const status = (s: CallStatus) => facts.filter((f) => f.status === s).length;
  const repeats = facts.map((f) => f.snapshot.pressCount - 1);
  // OPEN: ¿duraciones negativas (reloj/desorden) se excluyen (como aquí) o se cuentan?
  const nonNegative = (v: number | null): v is number => v !== null && v >= 0;

  // Última etiqueta/zona vista por mesa: el nombre se copia al momento del llamado y puede cambiar.
  const newestFirst = [...facts].sort((a, b) => b.snapshot.createdAt.getTime() - a.snapshot.createdAt.getTime());

  return {
    timezone: ctx.timeZone,
    from: ctx.range.from.toISOString(),
    to: ctx.range.to.toISOString(),
    group_by: ctx.groupBy,
    totals: {
      calls: facts.length,
      pending: status('pending'),
      in_progress: status('in_progress'),
      completed: status('completed'),
      repeated_presses: repeats.reduce((s, n) => s + n, 0),
      calls_with_repeated_presses: repeats.filter((n) => n > 0).length,
    },
    time_to_acknowledge: durationStats(facts.map((f) => f.msToAcknowledge).filter(nonNegative)),
    time_to_complete: durationStats(facts.map((f) => f.msToComplete).filter(nonNegative)),
    by_table: [...tally(newestFirst, (f) => f.snapshot.tableId).values()]
      .map(({ sample: s, calls }) => ({
        table_id: s.snapshot.tableId,
        table_label: s.snapshot.tableLabel,
        zone_id: s.snapshot.zoneId,
        zone_name: s.snapshot.zoneName,
        calls,
      }))
      .sort((a, b) => b.calls - a.calls || a.table_label.localeCompare(b.table_label)),
    by_zone: [...tally(newestFirst, (f) => f.snapshot.zoneId ?? '')
      .values()]
      .map(({ sample: s, calls }) => ({ zone_id: s.snapshot.zoneId, zone_name: s.snapshot.zoneName, calls }))
      .sort((a, b) => b.calls - a.calls || (a.zone_name ?? '').localeCompare(b.zone_name ?? '')),
    by_period: periods(facts, ctx),
  };
}
