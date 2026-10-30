import type { GroupBy, InventoryMetrics, RangePreset, ServiceCallMetrics } from '@modivara/analytics-contracts';
import type { MovementDto, MovementReasonDto, ProductDto, Unit } from '@modivara/commerce-contracts';
import { SPACES, TABLES, areaAt } from './plan';

// [DISEÑO] Datos de demo deterministas para los prototipos de métricas e inventario (PLAN-002). Mismo perfil que el seed real
// (`DEMO_CALL_PROFILE`, `BAR_PRODUCTS`, `DEMO_STOCK_PROFILE`) y la escena del editor (pisos y áreas de plan.tsx). Las funciones
// devuelven la forma exacta de los contratos (`ServiceCallMetrics`, `InventoryMetrics`, DTOs de commerce).

function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r: () => number, [lo, hi]: readonly [number, number]) => lo + r() * (hi - lo);
const pick = <T,>(r: () => number, weighted: readonly (readonly [T, number])[]): T => {
  let x = r() * weighted.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weighted) if ((x -= w) < 0) return v;
  return weighted[weighted.length - 1]![0];
};
const uuid = (r: () => number) => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ ((r() * 16) >> (Number(c) / 4))).toString(16));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const DAYS = 14;
export const TIMEZONE = 'America/Bogota';
// ponytail: los días se cortan en la zona del navegador, no en la del local; da igual para revisar el diseño.
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const NOW = new Date();
export const TODAY = startOfDay(NOW);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/* ---------- Mesas y áreas (escena del editor) ---------- */

export type TableInfo = { id: string; label: string; spaceId: string; spaceName: string; zoneId: string | null; zoneName: string | null };
const elementOf = new Map(SPACES.flatMap((s) => s.elements.flatMap((e) => (e.type === 'table' ? [[e.table_id, { e, s }] as const] : []))));
export const TABLE_INFO: TableInfo[] = TABLES.map((t) => {
  const placed = elementOf.get(t.id);
  const area = placed ? areaAt(placed.s.areas, placed.e) : undefined;
  return { id: t.id, label: t.label, spaceId: t.spaceId, spaceName: SPACES.find((s) => s.id === t.spaceId)!.name, zoneId: area?.id ?? null, zoneName: area?.name ?? null };
});
export const tableInfo = new Map(TABLE_INFO.map((t) => [t.id, t]));
export const ZONES = SPACES.flatMap((s) => (s.areas ?? []).map((a) => ({ id: a.id, name: a.name, spaceId: s.id, spaceName: s.name })));

/* ---------- Llamados ---------- */

export type DemoCall = { id: string; tableId: string; createdAt: number; ackAt: number | null; completedAt: number | null; pressCount: number };

const CALL_PROFILE = {
  hourWeights: [[12, 1], [13, 2], [14, 1], [15, 1], [16, 1], [17, 2], [18, 4], [19, 6], [20, 8], [21, 9], [22, 8], [23, 4]] as const,
  callsPerDay: 28, jitter: [-8, 12] as const, ackSeconds: [60, 240] as const, completionSeconds: [120, 360] as const,
  lateRate: 0.06, lateMinutes: [15, 40] as const, repeatRate: 0.2,
};
// Peso por mesa: las de la barra y las redondas del primer piso llaman más (misma idea que ACTIVITY del editor).
const TABLE_WEIGHT = [9, 7, 10, 8, 4, 3, 6, 5, 5, 3, 2, 1, 6, 7, 4, 3, 2];

function makeCalls(): DemoCall[] {
  const r = seeded(20261027);
  const tables = TABLES.map((t, i) => [t.id, TABLE_WEIGHT[i] ?? 1] as const);
  const calls: DemoCall[] = [];
  for (let d = -DAYS; d <= 0; d++) {
    const day = addDays(TODAY, d);
    const weekend = [5, 6].includes(day.getDay()) ? 1.35 : day.getDay() === 1 ? 0.75 : 1;
    const n = Math.round((CALL_PROFILE.callsPerDay + between(r, CALL_PROFILE.jitter)) * weekend);
    for (let i = 0; i < n; i++) {
      const hour = pick(r, CALL_PROFILE.hourWeights);
      const createdAt = day.getTime() + hour * HOUR + Math.floor(r() * HOUR);
      if (createdAt > NOW.getTime()) continue;
      const late = r() < CALL_PROFILE.lateRate;
      const ackS = late ? between(r, CALL_PROFILE.lateMinutes) * 60 : between(r, CALL_PROFILE.ackSeconds) * (hour >= 20 && hour <= 22 ? 1.25 : 1);
      const ackAt = createdAt + ackS * 1000 > NOW.getTime() ? null : createdAt + Math.round(ackS * 1000);
      const doneAt = ackAt && ackAt + between(r, CALL_PROFILE.completionSeconds) * 1000;
      const repeats = r() < CALL_PROFILE.repeatRate || late ? 1 + Math.floor(r() * 3) : 0;
      calls.push({ id: uuid(r), tableId: pick(r, tables), createdAt, ackAt, completedAt: doneAt && doneAt <= NOW.getTime() ? Math.round(doneAt) : null, pressCount: 1 + repeats });
    }
  }
  return calls.sort((a, b) => a.createdAt - b.createdAt);
}
export const CALLS = makeCalls();

/* ---------- Rango (como toMetricsQuery: en la zona del local, «7/30 días» incluyen hoy) ---------- */

export type Range = { range: RangePreset; from?: string; to?: string; groupBy?: GroupBy };
export const RANGE_OPTIONS = [['today', 'Hoy'], ['yesterday', 'Ayer'], ['last_7_days', '7 días'], ['last_30_days', '30 días']] as const;

export function resolveRange({ range, from, to }: Range): { from: number; to: number } {
  const end = Math.min(NOW.getTime(), addDays(TODAY, 1).getTime());
  switch (range) {
    case 'today': return { from: TODAY.getTime(), to: end };
    case 'yesterday': return { from: addDays(TODAY, -1).getTime(), to: TODAY.getTime() };
    case 'last_7_days': return { from: addDays(TODAY, -6).getTime(), to: end };
    case 'last_30_days': return { from: addDays(TODAY, -29).getTime(), to: end };
    case 'custom': {
      const [fy, fm, fd] = from!.split('-').map(Number);
      const [ty, tm, td] = to!.split('-').map(Number);
      return { from: new Date(fy!, fm! - 1, fd!).getTime(), to: Math.min(end, new Date(ty!, tm! - 1, td! + 1).getTime()) };
    }
  }
}
/** Por defecto, horas para un solo día y días para más. */
export const defaultGroupBy = (r: Range): GroupBy => r.groupBy ?? (r.range === 'today' || r.range === 'yesterday' ? 'hour' : 'day');

const dayFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric' });
const hourFmt = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', hour12: false });
/** Cubetas desde `from` hasta la actual (las futuras no aparecen), como `by_period` de la API. */
function buckets(from: number, to: number, groupBy: GroupBy) {
  const out: { start: number; label: string }[] = [];
  for (let t = from; t < to; ) {
    const d = new Date(t);
    out.push({ start: t, label: groupBy === 'day' ? dayFmt.format(d) : `${hourFmt.format(d)} h` });
    t = groupBy === 'day' ? addDays(d, 1).getTime() : t + HOUR;
  }
  return out;
}
const bucketIndex = (bs: { start: number }[], t: number) => {
  let i = bs.length - 1;
  while (i > 0 && bs[i]!.start > t) i--;
  return i;
};

const stats = (xs: number[]) => {
  if (!xs.length) return { count: 0, average_seconds: null, median_seconds: null };
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return { count: s.length, average_seconds: Math.round(s.reduce((a, b) => a + b, 0) / s.length), median_seconds: Math.round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2) };
};
const iso = (t: number) => new Date(t).toISOString();

export function serviceCallMetrics(q: Range & { zoneId?: string; tableId?: string }, calls = CALLS): ServiceCallMetrics {
  const { from, to } = resolveRange(q);
  const groupBy = defaultGroupBy(q);
  const rows = calls.filter((c) => c.createdAt >= from && c.createdAt < to && (!q.tableId || c.tableId === q.tableId) && (!q.zoneId || tableInfo.get(c.tableId)!.zoneId === q.zoneId));
  const byTable = new Map<string, number>();
  const byZone = new Map<string | null, number>();
  for (const c of rows) {
    byTable.set(c.tableId, (byTable.get(c.tableId) ?? 0) + 1);
    const z = tableInfo.get(c.tableId)!.zoneId;
    byZone.set(z, (byZone.get(z) ?? 0) + 1);
  }
  const bs = buckets(from, to, groupBy);
  const perBucket = bs.map(() => 0);
  for (const c of rows) perBucket[bucketIndex(bs, c.createdAt)]!++;
  return {
    timezone: TIMEZONE, from: iso(from), to: iso(to), group_by: groupBy,
    totals: {
      calls: rows.length,
      pending: rows.filter((c) => !c.ackAt).length,
      in_progress: rows.filter((c) => c.ackAt && !c.completedAt).length,
      completed: rows.filter((c) => c.completedAt).length,
      repeated_presses: rows.reduce((s, c) => s + c.pressCount - 1, 0),
      calls_with_repeated_presses: rows.filter((c) => c.pressCount > 1).length,
    },
    time_to_acknowledge: stats(rows.flatMap((c) => (c.ackAt ? [(c.ackAt - c.createdAt) / 1000] : []))),
    time_to_complete: stats(rows.flatMap((c) => (c.completedAt ? [(c.completedAt - c.createdAt) / 1000] : []))),
    by_table: [...byTable].map(([id, n]) => {
      const t = tableInfo.get(id)!;
      return { table_id: id, table_label: t.label, zone_id: t.zoneId, zone_name: t.zoneName, calls: n };
    }).sort((a, b) => b.calls - a.calls),
    by_zone: [...byZone].map(([id, n]) => ({ zone_id: id, zone_name: ZONES.find((z) => z.id === id)?.name ?? null, calls: n })).sort((a, b) => b.calls - a.calls),
    by_period: bs.map((b, i) => ({ bucket_start: iso(b.start), bucket_label: b.label, calls: perBucket[i]! })),
  };
}

/* ---------- Inventario ---------- */

export const STOCK_LOCATION = { id: 'b7c2a1e0-0000-4000-8000-000000000001', name: 'Principal', is_default: true, active: true };
const ir = seeded(20261028);
export const USERS = { inventario: { id: uuid(ir), name: 'Andrés Ruiz' }, barra: { id: uuid(ir), name: 'Laura Gómez' }, admin: { id: uuid(ir), name: 'Marta Díaz' } };
export const userName = new Map(Object.values(USERS).map((u) => [u.id, u.name]));

const BAR_PRODUCTS: { name: string; unit: Unit; category: string; stock: number; sku: string }[] = [
  { name: 'Cerveza', unit: 'bottle', category: 'Cervezas', stock: 48, sku: 'CER-330' },
  { name: 'Cerveza artesanal', unit: 'bottle', category: 'Cervezas', stock: 24, sku: 'CER-ART' },
  { name: 'Ron', unit: 'bottle', category: 'Licores', stock: 12, sku: 'LIC-RON' },
  { name: 'Aguardiente', unit: 'bottle', category: 'Licores', stock: 12, sku: 'LIC-AGU' },
  { name: 'Whisky', unit: 'bottle', category: 'Licores', stock: 8, sku: 'LIC-WHI' },
  { name: 'Vodka', unit: 'bottle', category: 'Licores', stock: 8, sku: 'LIC-VOD' },
  { name: 'Gaseosa', unit: 'bottle', category: 'Sin alcohol', stock: 36, sku: 'SIN-GAS' },
  { name: 'Agua', unit: 'bottle', category: 'Sin alcohol', stock: 36, sku: 'SIN-AGU' },
  { name: 'Limón', unit: 'kg', category: 'Insumos', stock: 5.5, sku: 'INS-LIM' },
  { name: 'Hielo', unit: 'kg', category: 'Insumos', stock: 40, sku: 'INS-HIE' },
];
export const PRODUCTS: ProductDto[] = BAR_PRODUCTS.map((p) => ({ id: uuid(ir), name: p.name, sku: p.sku, category: p.category, unit: p.unit, active: true }));
export const productById = new Map(PRODUCTS.map((p) => [p.id, p]));
export const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category!))];

const SEEDED_REASONS: [string, MovementReasonDto['direction']][] = [
  ['Compra', 'in'], ['Devolución de cliente', 'in'], ['Venta', 'out'], ['Merma', 'out'], ['Rotura', 'out'], ['Vencimiento', 'out'],
  ['Cortesía', 'out'], ['Consumo interno', 'out'], ['Devolución a proveedor', 'out'], ['Corrección de conteo', 'adjust'],
];
export const REASONS: MovementReasonDto[] = SEEDED_REASONS.map(([name, direction]) => ({ id: uuid(ir), name, direction, active: true }));
export const reasonById = new Map(REASONS.map((r) => [r.id, r]));
const reason = (name: string) => REASONS.find((x) => x.name === name)!;

/** Cantidad NUMERIC(12,3) del contrato («12.000», «-1.500»). */
export const dec = (n: number) => n.toFixed(3);
const num = (s: string) => Number(s);

function makeMovements(): MovementDto[] {
  const r = seeded(20261029);
  const out: MovementDto[] = [];
  BAR_PRODUCTS.forEach((p, index) => {
    const product = PRODUCTS[index]!;
    const step = p.unit === 'kg' ? 0.5 : 1;
    let balance = 0;
    const push = (at: number, r0: MovementReasonDto, delta: number, actor: string, note: string | null = null) => {
      balance += delta;
      out.push({ id: uuid(r), stock_location_id: STOCK_LOCATION.id, product_id: product.id, direction: r0.direction, reason_id: r0.id, delta: dec(delta), balance_after: dec(balance), note, actor_user_id: actor, occurred_at: iso(at) });
    };
    push(addDays(TODAY, -DAYS - 1).getTime() + 10 * HOUR, reason('Compra'), p.stock, USERS.inventario.id, 'Stock inicial');
    for (let d = -DAYS; d <= 0; d++) {
      const day = addDays(TODAY, d).getTime();
      if ((d + DAYS + index) % 5 === 0 || balance < p.stock * 0.3) {
        const at = day + 11 * HOUR + Math.floor(r() * HOUR);
        if (at < NOW.getTime()) push(at, reason('Compra'), Math.max(step, Math.round((p.stock * 0.6) / step) * step), USERS.inventario.id);
      }
      if (p.name === 'Ron' && d === -7) push(day + 15 * HOUR, reason('Corrección de conteo'), -1, USERS.inventario.id, 'Conteo semanal: faltaba una botella');
      // En orden de hora: `balance_after` sigue el tiempo dentro del producto.
      const times = Array.from({ length: 1 + Math.floor(r() * 2) }, () => day + (18 + Math.floor(r() * 6)) * HOUR + Math.floor(r() * HOUR)).sort((a, b) => a - b);
      for (const at of times) {
        const qty = Math.min(balance, Math.max(step, Math.round((r() * p.stock * 0.08) / step) * step));
        const x = r();
        const why = x < 0.8 ? 'Venta' : x < 0.92 ? 'Merma' : 'Cortesía';
        if (qty > 0 && at < NOW.getTime()) push(at, reason(why), -qty, USERS.barra.id, why === 'Merma' && r() < 0.5 ? 'Se cayó en la barra' : null);
      }
    }
  });
  return out.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
/** Movimientos, del más reciente al más antiguo (como `GET …/movements`). */
export const MOVEMENTS = makeMovements();

/** Saldo actual = `balance_after` del último movimiento del producto. */
export function balancesOf(movements: MovementDto[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of movements) if (!m.has(mv.product_id)) m.set(mv.product_id, num(mv.balance_after));
  return m;
}

/** Salidas promedio por día de los últimos 7 días, para dar contexto al saldo (no es una predicción). */
export function avgDailyOut(movements: MovementDto[], productId: string) {
  const since = addDays(TODAY, -6).getTime();
  const outs = movements.filter((m) => m.product_id === productId && m.direction === 'out' && Date.parse(m.occurred_at) >= since);
  return -outs.reduce((s, m) => s + num(m.delta), 0) / 7;
}

/** Saldo al cierre de cada uno de los últimos `days` días (para la tendencia). */
export function balanceTrend(movements: MovementDto[], productId: string, days = DAYS) {
  const mine = movements.filter((m) => m.product_id === productId).reverse();
  return Array.from({ length: days }, (_, i) => {
    const end = addDays(TODAY, i - days + 2).getTime();
    const last = mine.filter((m) => Date.parse(m.occurred_at) < end).at(-1);
    return last ? num(last.balance_after) : 0;
  });
}

export function inventoryMetrics(q: Range, movements = MOVEMENTS): InventoryMetrics {
  const { from, to } = resolveRange(q);
  const groupBy = defaultGroupBy(q);
  const rows = movements.filter((m) => { const t = Date.parse(m.occurred_at); return t >= from && t < to; });
  const bs = buckets(from, to, groupBy);
  const per = bs.map(() => ({ n: 0, in: 0, out: 0, adjust: 0 }));
  for (const m of rows) {
    const b = per[bucketIndex(bs, Date.parse(m.occurred_at))]!;
    b.n++;
    b[m.direction] += num(m.delta);
  }
  const group = <K,>(key: (m: MovementDto) => K) => {
    const g = new Map<K, MovementDto[]>();
    for (const m of rows) g.set(key(m), [...(g.get(key(m)) ?? []), m]);
    return [...g];
  };
  const total = (ms: MovementDto[]) => dec(ms.reduce((s, m) => s + num(m.delta), 0));
  return {
    timezone: TIMEZONE, from: iso(from), to: iso(to), group_by: groupBy,
    by_direction: group((m) => m.direction).map(([direction, ms]) => ({ direction, movement_count: ms.length, total_delta: total(ms) })),
    by_reason: group((m) => m.reason_id).map(([id, ms]) => ({ direction: reasonById.get(id)!.direction, reason_id: id, reason_name: reasonById.get(id)!.name, movement_count: ms.length, total_delta: total(ms) }))
      .sort((a, b) => b.movement_count - a.movement_count),
    by_period: bs.map((b, i) => ({ bucket_start: iso(b.start), bucket_label: b.label, movement_count: per[i]!.n, in_delta: dec(per[i]!.in), out_delta: dec(per[i]!.out), adjust_delta: dec(per[i]!.adjust) })),
    balances: [...balancesOf(movements)].map(([productId, q0]) => ({ stock_location_id: STOCK_LOCATION.id, product_id: productId, product_name: productById.get(productId)!.name, balance: dec(q0), as_of: iso(NOW.getTime()) })),
  };
}

/* ---------- Formato ---------- */

const UNIT: Record<Unit, [string, string]> = { unit: ['unidad', 'unidades'], bottle: ['botella', 'botellas'], kg: ['kg', 'kg'], g: ['g', 'g'], l: ['l', 'l'], ml: ['ml', 'ml'] };
const qtyFmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });
export const unitWord = (unit: Unit, n: number) => UNIT[unit][Math.abs(n) === 1 ? 0 : 1];
export const fmtQty = (n: number | string, unit: Unit) => `${qtyFmt.format(Number(n))} ${unitWord(unit, Number(n))}`;
export const fmtSigned = (n: number | string, unit: Unit) => `${Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : ''}${fmtQty(Math.abs(Number(n)), unit)}`;
export const fmtNum = (n: number) => qtyFmt.format(n);
/** «1 min 05 s», «48 s». */
export function fmtSeconds(s: number | null) {
  if (s === null) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.round(s)} s`;
}
const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
/** «Hoy 21:40», «Ayer 19:05», «lun, 20 oct 18:30». */
export function fmtWhen(isoOrMs: string | number) {
  const d = new Date(isoOrMs);
  const day = startOfDay(d).getTime();
  const prefix = day === TODAY.getTime() ? 'Hoy' : day === addDays(TODAY, -1).getTime() ? 'Ayer' : dateFmt.format(d);
  return `${prefix} ${timeFmt.format(d)}`;
}
export const DIRECTION_TEXT = { in: 'Entrada', out: 'Salida', adjust: 'Ajuste' } as const;
