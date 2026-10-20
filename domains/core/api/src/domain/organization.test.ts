import { describe, expect, it } from 'vitest';
import { ValidationError } from '@modivara/core-contracts';
import { Organization } from './organization.js';

describe('Organization', () => {
  it('crea un negocio activo', () => {
    const o = Organization.create({ id: 'o1', slug: 'bar-sol', name: ' Bar Sol ' });
    expect(o).toMatchObject({ slug: 'bar-sol', name: 'Bar Sol', isPlatform: false, isActive: true });
  });
  it.each(['labs', 'api', 'sim', 'assets', 'login', 'static'])('un cliente no puede usar el slug reservado %s', (slug) => {
    expect(() => Organization.create({ id: 'o1', slug, name: 'X' })).toThrow(ValidationError);
  });
  it('la plataforma sí puede usar labs', () => {
    expect(Organization.create({ id: 'o1', slug: 'labs', name: 'Labs', isPlatform: true }).isPlatform).toBe(true);
  });
  it.each(['Bar-Sol', 'ab', 'bar sol'])('rechaza el slug %s', (slug) => {
    expect(() => Organization.create({ id: 'o1', slug, name: 'X' })).toThrow(ValidationError);
  });
  it('desactivar es idempotente y conserva la primera fecha', () => {
    const o = Organization.create({ id: 'o1', slug: 'bar-sol', name: 'X' });
    o.deactivate(new Date('2026-01-01'));
    o.deactivate(new Date('2026-02-01'));
    expect(o.deactivatedAt).toEqual(new Date('2026-01-01'));
    expect(o.isActive).toBe(false);
  });
});
