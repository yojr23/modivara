import { describe, expect, it } from 'vitest';
import { addDays, civilDateIn, localTimeToUtc, seededRandom } from './seed-time.js';

describe('seed-time', () => {
  it('seededRandom es reproducible y está en [0, 1)', () => {
    const a = seededRandom(7), b = seededRandom(7);
    const xs = Array.from({ length: 5 }, a);
    expect(xs).toEqual(Array.from({ length: 5 }, b));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it('hora local de Bogotá (UTC-5) a UTC y fecha civil de vuelta', () => {
    const at = localTimeToUtc('America/Bogota', { year: 2026, month: 10, day: 26 }, 21, 30);
    expect(at.toISOString()).toBe('2026-10-27T02:30:00.000Z');
    expect(civilDateIn('America/Bogota', at)).toEqual({ year: 2026, month: 10, day: 26 });
    expect(addDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
  });
});
