import type { Unit } from '@modivara/commerce-contracts';

// Formato común de las pantallas (es-CO). Las fechas se muestran en la zona del navegador.
// ponytail: el tablero y el portal se usan en el local, así que coincide con la zona del local; usar `location.timezone` si no.

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

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const dayFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric' });
const hourFmt = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', hour12: false });
/** Rótulo de una cubeta de métricas desde su inicio (la API manda `bucket_label` en ISO): «vie 24» o «21 h». */
export const bucketLabel = (start: string, groupBy: 'hour' | 'day') => (groupBy === 'day' ? dayFmt.format(new Date(start)) : `${hourFmt.format(new Date(start))} h`);
const timeFmt = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
/** «Hoy 21:40», «Ayer 19:05», «lun, 20 oct 18:30». */
export function fmtWhen(isoOrMs: string | number) {
  const d = new Date(isoOrMs);
  const today = startOfDay(new Date()).getTime();
  const day = startOfDay(d).getTime();
  const prefix = day === today ? 'Hoy' : day === today - 86_400_000 ? 'Ayer' : dateFmt.format(d);
  return `${prefix} ${timeFmt.format(d)}`;
}
