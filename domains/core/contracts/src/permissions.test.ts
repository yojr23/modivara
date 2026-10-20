import { describe, expect, it } from 'vitest';
import { PERMISSIONS, permissionsFor } from './permissions.js';

const plain = { isOwner: false, isPlatform: false };

describe('permissionsFor', () => {
  it('staff opera llamados pero no gestiona mesas ni inventario', () => {
    const p = permissionsFor(['staff'], plain);
    expect(p.has('hospitality.calls.complete')).toBe(true);
    expect(p.has('hospitality.tables.manage')).toBe(false);
    expect(p.has('commerce.stock.write')).toBe(false);
  });

  it('inventory solo ve métricas de inventario', () => {
    const p = permissionsFor(['inventory'], plain);
    expect(p.has('analytics.inventory.read')).toBe(true);
    expect(p.has('analytics.calls.read')).toBe(false);
    expect(p.has('commerce.reasons.manage')).toBe(false);
  });

  it('une los permisos de varios roles', () => {
    const p = permissionsFor(['staff', 'inventory'], plain);
    expect(p.has('hospitality.calls.read')).toBe(true);
    expect(p.has('commerce.stock.write')).toBe(true);
  });

  it('el dueño es admin aunque su membresía no lo diga', () => {
    expect(permissionsFor([], { isOwner: true, isPlatform: false }).has('core.users.manage')).toBe(true);
  });

  it('ningún rol de local otorga permisos de plataforma', () => {
    const p = permissionsFor(['admin', 'staff', 'inventory'], { isOwner: true, isPlatform: false });
    expect([...p].some((x) => x.startsWith('platform.'))).toBe(false);
  });

  it('el superadmin recibe todos los permisos', () => {
    expect(permissionsFor([], { isOwner: false, isPlatform: true }).size).toBe(PERMISSIONS.length);
  });
});
