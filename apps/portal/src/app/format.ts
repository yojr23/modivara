import type { Unit } from '@modivara/commerce-contracts';

// Formato común de las pantallas (es-CO). Las fechas van en la zona del local (`location.timezone`); el tablero en vivo usa tiempos relativos.

/** Cantidad NUMERIC(12,3) del contrato («12.000», «-1.500»). */
export const dec = (n: number) => n.toFixed(3);

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

const fmts = new Map<string, Intl.DateTimeFormat>();
const dtf = (tz: string | undefined, o: Intl.DateTimeFormatOptions, locale = 'es-CO') => {
  const k = `${locale}|${tz}|${JSON.stringify(o)}`;
  let f = fmts.get(k);
  if (!f) fmts.set(k, (f = new Intl.DateTimeFormat(locale, { ...o, timeZone: tz })));
  return f;
};

/** Rótulo de una cubeta de métricas desde su inicio (la API agrupa en la zona del local): «vie 24» o «21 h». */
export const bucketLabel = (start: string, groupBy: 'hour' | 'day', tz?: string) =>
  groupBy === 'day' ? dtf(tz, { weekday: 'short', day: 'numeric' }).format(new Date(start)) : `${dtf(tz, { hour: 'numeric', hour12: false }).format(new Date(start))} h`;

/** Día calendario «YYYY-MM-DD» de un instante en la zona `tz` (el local; sin `tz`, el navegador). */
export const dayKey = (ms: number, tz?: string) => dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(ms);

/** Instante (ms) en que empieza el día «YYYY-MM-DD» en `tz`. */
export function dayStart(day: string, tz?: string) {
  const offset = (t: number) => { // zona − UTC en el instante t
    const p = Object.fromEntries(dtf(tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }, 'en-US').formatToParts(t).map((x) => [x.type, +x.value]));
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  };
  const utc = Date.parse(`${day}T00:00:00Z`);
  return utc - offset(utc - offset(utc));
}

/** Día «YYYY-MM-DD» a `n` días de `day` (n negativo = atrás), sin saltos por horario de verano: parte del mediodía. */
export const addDays = (day: string, n: number, tz?: string) => dayKey(dayStart(day, tz) + (n * 24 + 12) * 3_600_000, tz);

/** «Hoy 21:40», «Ayer 19:05», «lun, 20 oct 18:30» en la zona `tz` (la del local; sin `tz`, la del navegador). */
export function fmtWhen(isoOrMs: string | number, tz?: string) {
  const ms = new Date(isoOrMs).getTime();
  const today = dayKey(Date.now(), tz);
  const day = dayKey(ms, tz);
  const prefix = day === today ? 'Hoy' : day === dayKey(dayStart(today, tz) - 1, tz) ? 'Ayer' : dtf(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
  return `${prefix} ${dtf(tz, { hour: '2-digit', minute: '2-digit', hour12: false }).format(ms)}`;
}

/** «hace 40 s», «hace 5 min», «hace 3 h», «hace 2 d» desde un instante hasta `now` (ms). */
export function agoLabel(from: number, now: number) {
  const s = Math.max(0, Math.floor((now - from) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return s < 86_400 ? `hace ${Math.floor(s / 3600)} h` : `hace ${Math.floor(s / 86_400)} d`;
}
