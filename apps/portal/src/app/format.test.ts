import { expect, it } from 'vitest';
import { parseDecimal } from './format';

it('parseDecimal acepta coma o punto, sin cero inicial, hasta 3 decimales', () => {
  expect(['0,5', '1.5', ',5', '.5', '12', '0,125'].map(parseDecimal)).toEqual([0.5, 1.5, 0.5, 0.5, 12, 0.125]);
  for (const bad of ['', ',', '1,2345', '1.000,5', '-1', 'abc']) expect(parseDecimal(bad)).toBeNaN();
});
