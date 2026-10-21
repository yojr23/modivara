import { describe, expect, it } from 'vitest';
import { idOf } from './decorators.js';

describe('idOf', () => {
  it('acepta UUID y rechaza cualquier otro valor antes de llegar a la base', () => {
    expect(idOf('0192d4f0-0000-7000-8000-000000000001')).toBe('0192d4f0-0000-7000-8000-000000000001');
    expect(() => idOf('abc')).toThrow();
    expect(() => idOf("1' OR '1'='1")).toThrow();
  });
});
