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

  it('cashier opera y consulta ventas pero no anula ni gestiona el catálogo', () => {
    const p = permissionsFor(['cashier'], plain);
    expect([...p].sort()).toEqual(['pos.sales.operate', 'pos.sales.read']);
  });

  it('staff e inventory no reciben permisos de POS', () => {
    const p = permissionsFor(['staff', 'inventory'], plain);
    expect([...p].some((x) => x.startsWith('pos.'))).toBe(false);
  });

  it('admin recibe los cuatro permisos de POS', () => {
    const p = permissionsFor(['admin'], plain);
    expect((['pos.catalog.manage', 'pos.sales.operate', 'pos.sales.void', 'pos.sales.read'] as const).every((x) => p.has(x))).toBe(true);
  });

  it('el dueño es admin aunque su membresía no lo diga', () => {
    expect(permissionsFor([], { isOwner: true, isPlatform: false }).has('core.users.manage')).toBe(true);
  });

  it('ningún rol de local otorga permisos de plataforma', () => {
    const p = permissionsFor(['admin', 'staff', 'inventory', 'cashier'], { isOwner: true, isPlatform: false });
    expect([...p].some((x) => x.startsWith('platform.'))).toBe(false);
  });

  it('el superadmin recibe todos los permisos', () => {
    expect(permissionsFor([], { isOwner: false, isPlatform: true }).size).toBe(PERMISSIONS.length);
  });
});
