import type { GroupBy, InventoryMetrics } from '@modivara/analytics-contracts';
import { formatMilli, parseMilli } from './decimal.js';
import type { DateRange } from './date-range.js';
import type { StockMovementFact } from './stock-movement-fact.js';
import { bucketOf } from './time-zone.js';

const DIRECTIONS = ['in', 'out', 'adjust'] as const;

/** Saldo actual = `balance_after` del último movimiento por (lugar, producto). */
export function latestPerPlaceAndProduct(facts: readonly StockMovementFact[]): StockMovementFact[] {
  const latest = new Map<string, StockMovementFact>();
  for (const f of facts) {
    const k = `${f.snapshot.stockLocationId}|${f.snapshot.productId}`;
    const cur = latest.get(k);
    if (!cur || isNewer(f, cur)) latest.set(k, f);
  }
  return [...latest.values()];
}

// OPEN: ¿cómo desempatar dos movimientos con el mismo occurred_at? Provisional: movement_id mayor (determinista).
function isNewer(a: StockMovementFact, b: StockMovementFact): boolean {
  const ta = a.snapshot.occurredAt.getTime();
  const tb = b.snapshot.occurredAt.getTime();
  return ta !== tb ? ta > tb : a.movementId > b.movementId;
}

/**
 * `movements`: movimientos del periodo; `latest`: último movimiento por (lugar, producto) en todo el historial
 * (el saldo actual no depende del rango).
 */
export function computeInventoryMetrics(
  movements: readonly StockMovementFact[],
  latest: readonly StockMovementFact[],
  ctx: { timeZone: string; groupBy: GroupBy; range: DateRange },
): InventoryMetrics {
  const byDirection = new Map<string, { count: number; total: bigint }>(DIRECTIONS.map((d) => [d, { count: 0, total: 0n }]));
  const byReason = new Map<string, { sample: StockMovementFact; count: number; total: bigint }>();
  const byPeriod = new Map<string, { start: Date; label: string; count: number; totals: Record<string, bigint> }>();

  for (const m of movements) {
    const s = m.snapshot;
    const d = byDirection.get(s.direction)!;
    d.count++;
    d.total += m.deltaMilli;

    const rk = `${s.direction}|${s.reasonId}`;
    const r = byReason.get(rk);
    if (!r) byReason.set(rk, { sample: m, count: 1, total: m.deltaMilli });
    else {
      r.count++;
      r.total += m.deltaMilli;
      if (s.occurredAt > r.sample.snapshot.occurredAt) r.sample = m; // nombre de motivo más reciente
    }

    const b = bucketOf(s.occurredAt, ctx.groupBy, ctx.timeZone);
    const p = byPeriod.get(b.label) ?? { start: b.start, label: b.label, count: 0, totals: { in: 0n, out: 0n, adjust: 0n } };
    p.count++;
    p.totals[s.direction]! += m.deltaMilli;
    byPeriod.set(b.label, p);
  }

  return {
    timezone: ctx.timeZone,
    from: ctx.range.from.toISOString(),
    to: ctx.range.to.toISOString(),
    group_by: ctx.groupBy,
    by_direction: DIRECTIONS.map((direction) => {
      const d = byDirection.get(direction)!;
      return { direction, movement_count: d.count, total_delta: formatMilli(d.total) };
    }),
    by_reason: [...byReason.values()]
      .map((r) => ({
        direction: r.sample.snapshot.direction,
        reason_id: r.sample.snapshot.reasonId,
        reason_name: r.sample.snapshot.reasonName,
        movement_count: r.count,
        total_delta: formatMilli(r.total),
      }))
      .sort((a, b) => a.direction.localeCompare(b.direction) || a.reason_name.localeCompare(b.reason_name)),
    by_period: [...byPeriod.values()]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((p) => ({
        bucket_start: p.start.toISOString(),
        bucket_label: p.label,
        movement_count: p.count,
        in_delta: formatMilli(p.totals.in!),
        out_delta: formatMilli(p.totals.out!),
        adjust_delta: formatMilli(p.totals.adjust!),
      })),
    balances: latest
      .map((f) => ({
        stock_location_id: f.snapshot.stockLocationId,
        product_id: f.snapshot.productId,
        product_name: f.snapshot.productName,
        balance: formatMilli(parseMilli(f.snapshot.balanceAfter)),
        as_of: f.snapshot.occurredAt.toISOString(),
      }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name) || a.stock_location_id.localeCompare(b.stock_location_id)),
  };
}

