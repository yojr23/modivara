/** Aritmética de calendario en una zona IANA usando solo `Intl` (sin librerías). */
export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(instant: Date, timeZone: string): LocalDate & { hour: number } {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour! };
}

/** Desfase (ms) de la zona respecto a UTC en ese instante: hora local − hora UTC. */
function offsetMs(utcMs: number, timeZone: string): number {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Instante UTC de una hora de pared local. En saltos de DST una hora inexistente se corre
 * hacia adelante y una repetida toma la primera; Colombia no usa DST.
 */
export function localToUtc(date: LocalDate, hour: number, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour);
  const first = offsetMs(guess, timeZone);
  let t = guess - first;
  const second = offsetMs(t, timeZone);
  if (second !== first) t = guess - second;
  return new Date(t);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function parseLocalDate(value: string): LocalDate {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

export const startOfLocalDay = (date: LocalDate, timeZone: string): Date => localToUtc(date, 0, timeZone);

const pad = (n: number) => String(n).padStart(2, '0');

export type BucketUnit = 'hour' | 'day';

export interface Bucket {
  start: Date;
  label: string; // hora local, p. ej. 2026-10-19 o 2026-10-19T23:00
}

/** Cubeta (hora o día local) a la que pertenece un instante. */
export function bucketOf(instant: Date, unit: BucketUnit, timeZone: string): Bucket {
  const p = localParts(instant, timeZone);
  const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return unit === 'day'
    ? { start: localToUtc(p, 0, timeZone), label: day }
    : { start: localToUtc(p, p.hour, timeZone), label: `${day}T${pad(p.hour)}:00` };
}

/**
 * Todas las cubetas de [from, to) en orden, para graficar con ceros. No pasa de la cubeta que contiene `until`
 * (las horas o días futuros no son «cero llamados»). Una hora repetida por DST queda como una sola cubeta, igual que en `bucketOf`.
 */
export function bucketsBetween(from: Date, to: Date, unit: BucketUnit, timeZone: string, until: Date): Bucket[] {
  const out: Bucket[] = [];
  const end = Math.min(to.getTime(), until.getTime() + 1);
  for (let t = from.getTime(); t < end; ) {
    const b = bucketOf(new Date(t), unit, timeZone);
    if (out.at(-1)?.label !== b.label) out.push(b);
    t = unit === 'hour' ? t + 3_600_000 : startOfLocalDay(addDays(localParts(b.start, timeZone), 1), timeZone).getTime();
  }
  return out;
}
