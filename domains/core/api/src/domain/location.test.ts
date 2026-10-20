import { describe, expect, it } from 'vitest';
import { InvalidValueError } from './errors.js';
import { Location } from './location.js';

describe('Location', () => {
  it('usa America/Bogota por defecto', () => {
    expect(Location.create({ id: 'l1', organizationId: 'o1', name: 'Centro' }).timezone).toBe('America/Bogota');
  });
  it('acepta una zona válida', () => {
    expect(Location.create({ id: 'l1', organizationId: 'o1', name: 'Centro', timezone: 'Europe/Madrid' }).timezone).toBe('Europe/Madrid');
  });
  it('rechaza una zona inventada', () => {
    expect(() => Location.create({ id: 'l1', organizationId: 'o1', name: 'Centro', timezone: 'Mars/Olympus' })).toThrow(InvalidValueError);
  });
  it('exige nombre', () => {
    expect(() => Location.create({ id: 'l1', organizationId: 'o1', name: '  ' })).toThrow(InvalidValueError);
  });
});
