import { describe, expect, it } from 'vitest';
import { formatMilli, MAX_MILLI, parseMilli } from './decimal.js';
import { isZeroQuantity } from './catalog.js';

describe('decimal NUMERIC(12,3)', () => {
  it('es exacto: 0.1 + 0.2 = 0.3', () => {
    expect(formatMilli(parseMilli('0.1') + parseMilli('0.2'))).toBe('0.300');
  });

  it('ida y vuelta con signo y límites', () => {
    expect(parseMilli('-2.5')).toBe(-2500n);
    expect(formatMilli(-2500n)).toBe('-2.500');
    expect(parseMilli('999999999.999')).toBe(MAX_MILLI);
  });

  it('rechaza formatos fuera de NUMERIC(12,3)', () => {
    for (const bad of ['1.2345', '1234567890', 'abc', '', '1.', '+1']) expect(() => parseMilli(bad)).toThrow(RangeError);
  });

  it('isZeroQuantity', () => {
    expect(isZeroQuantity('-0.000')).toBe(true);
    expect(isZeroQuantity('0.001')).toBe(false);
  });
});
