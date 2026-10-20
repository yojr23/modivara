import { describe, expect, it } from 'vitest';
import { InvalidQuantityError, QuantityOutOfRangeError } from './errors.js';
import { Quantity } from './quantity.js';

const q = Quantity.parse;

describe('Quantity', () => {
  it('es exacta: 0.1 + 0.2 = 0.3', () => {
    expect(q('0.1').plus(q('0.2')).toString()).toBe('0.300');
    expect(q('0.1').plus(q('0.2')).equals(q('0.3'))).toBe(true);
  });
  it('normaliza a 3 decimales y maneja signos', () => {
    expect(q('1.5').toString()).toBe('1.500');
    expect(q('-0.5').toString()).toBe('-0.500');
    expect(q('-0').toString()).toBe('0.000');
    expect(q('2').negate().toString()).toBe('-2.000');
    expect(q('1.250').minus(q('2')).toString()).toBe('-0.750');
  });
  it('rechaza formatos inválidos y más de 3 decimales', () => {
    for (const bad of ['', 'abc', '1.0001', '1,5', '.5', '1e3', ' 1']) {
      expect(() => q(bad)).toThrow(InvalidQuantityError);
    }
  });
  it('respeta el límite de NUMERIC(12,3)', () => {
    expect(q('999999999.999').toString()).toBe('999999999.999');
    expect(() => q('1000000000')).toThrow(InvalidQuantityError);
    expect(() => q('999999999.999').plus(q('0.001'))).toThrow(QuantityOutOfRangeError);
  });
});
