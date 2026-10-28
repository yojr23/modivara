// Utilidades SOLO para seeds de demo (historial con fechas pasadas): PRNG reproducible y hora local → instante UTC.

/** PRNG mulberry32: misma semilla, misma secuencia (los seeds no usan Math.random). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CivilDate { year: number; month: number; day: number }

const parts = (timeZone: string, at: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(at).map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return { year: p.year!, month: p.month!, day: p.day!, utc: Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) };
};

/** Fecha civil de `at` en la zona horaria. */
export function civilDateIn(timeZone: string, at: Date): CivilDate {
  const { year, month, day } = parts(timeZone, at);
  return { year, month, day };
}

/** Instante UTC de `date` a las `hour:minute` (hora local de la zona). ponytail: una sola corrección de offset; en el salto de DST puede errar una hora. */
export function localTimeToUtc(timeZone: string, date: CivilDate, hour = 0, minute = 0, second = 0): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second);
  return new Date(guess - (parts(timeZone, new Date(guess)).utc - guess));
}

/** Suma `days` (negativo = atrás) a una fecha civil. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}
