import { describe, expect, it } from 'vitest';
import { AppUser } from './app-user.js';
import { InvalidValueError } from './errors.js';
import { Location } from './location.js';
import { LocationMembership } from './location-membership.js';

const user = (org: string) => AppUser.create({ id: 'u1', organizationId: org, username: 'ana', displayName: 'Ana', passwordHash: 'h', now: new Date() });
const loc = (org: string) => Location.create({ id: 'l1', organizationId: org, name: 'Centro' });

describe('LocationMembership', () => {
  it('toma el negocio del usuario y quita roles repetidos', () => {
    const m = LocationMembership.create({ id: 'm1', user: user('o1'), location: loc('o1'), roles: ['staff', 'staff', 'inventory'] });
    expect(m.organizationId).toBe('o1');
    expect(m.roles).toEqual(['staff', 'inventory']);
  });
  it('rechaza usuario y local de negocios distintos', () => {
    expect(() => LocationMembership.create({ id: 'm1', user: user('o1'), location: loc('o2'), roles: ['staff'] })).toThrow(InvalidValueError);
  });
  it('rechaza roles vacíos o desconocidos', () => {
    expect(() => LocationMembership.create({ id: 'm1', user: user('o1'), location: loc('o1'), roles: [] })).toThrow(InvalidValueError);
    expect(() => LocationMembership.create({ id: 'm1', user: user('o1'), location: loc('o1'), roles: ['root'] })).toThrow(InvalidValueError);
    const m = LocationMembership.create({ id: 'm1', user: user('o1'), location: loc('o1'), roles: ['staff'] });
    expect(() => m.setRoles([])).toThrow(InvalidValueError);
  });
});
