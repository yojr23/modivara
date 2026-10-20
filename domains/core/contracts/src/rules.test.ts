import { describe, expect, it } from 'vitest';
import { isReservedSlug, isValidPassword, isValidSlug, isValidUsername } from './rules.js';

describe('reglas puras', () => {
  it('slug', () => {
    expect(isValidSlug('bar-sol')).toBe(true);
    expect(isValidSlug('Bar-Sol')).toBe(false);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('-x-')).toBe(false);
    expect(isReservedSlug('api')).toBe(true);
  });
  it('username', () => {
    expect(isValidUsername('mesero.1')).toBe(true);
    expect(isValidUsername('Mesero')).toBe(false);
    expect(isValidUsername('a b c')).toBe(false);
  });
  it('contraseña', () => {
    expect(isValidPassword('Abcdef12')).toBe(true);
    expect(isValidPassword('abcdef12')).toBe(false);
    expect(isValidPassword('Abcdefgh')).toBe(false);
  });
});
