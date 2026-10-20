import type { RangePreset } from '@modivara/analytics-contracts';
import { addDays, localParts, parseLocalDate, startOfLocalDay } from './time-zone.js';

/** Intervalo semiabierto [from, to). */
export interface DateRange {
  from: Date;
  to: Date;
}

export interface RangeSpec {
  range: RangePreset;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Resuelve el atajo en el calendario de la zona del local.
 * OPEN: ¿«últimos 7/30 días» incluyen hoy (aquí sí: hoy y los 6/29 anteriores) o terminan ayer?
 */
export function resolveRange(spec: RangeSpec, now: Date, timeZone: string): DateRange {
  const today = localParts(now, timeZone);
  const day = (offset: number) => startOfLocalDay(addDays(today, offset), timeZone);
  switch (spec.range) {
    case 'today':
      return { from: day(0), to: day(1) };
    case 'yesterday':
      return { from: day(-1), to: day(0) };
    case 'last_7_days':
      return { from: day(-6), to: day(1) };
    case 'last_30_days':
      return { from: day(-29), to: day(1) };
    case 'custom': {
      if (!spec.from || !spec.to) throw new RangeError('custom exige from y to');
      return {
        from: startOfLocalDay(parseLocalDate(spec.from), timeZone),
        to: startOfLocalDay(addDays(parseLocalDate(spec.to), 1), timeZone), // `to` inclusivo
      };
    }
  }
}

export const inRange = (instant: Date, r: DateRange): boolean => instant >= r.from && instant < r.to;
