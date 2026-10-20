import { describe, expect, it } from 'vitest';
import { ValidationError } from '@modivara/core-contracts';
import { Location } from './location.js';

describe('Location', () => {
  it('usa America/Bogota por defecto', () => {
    expect(Location.create({ id: 'l1', organizationId: 'o1', name: 'Centro' }).timezone).toBe('America/Bogota');
  });
  it('acepta una zona válida', () => {
    expect(Location.create({ id: 'l1', organizationId: 'o1', name: 'Centro', timezone: 'Europe/Madrid' }).timezone).toBe('Europe/Madrid');
  });
  it('rechaza una zona inventada', () => {
    expect(() => Location.create({ id: 'l1', organizationId: 'o1', name: 'Centro', timezone: 'Mars/Olympus' })).toThrow(ValidationError);
  });
  it('exige nombre', () => {
    expect(() => Location.create({ id: 'l1', organizationId: 'o1', name: '  ' })).toThrow(ValidationError);
  });
});
