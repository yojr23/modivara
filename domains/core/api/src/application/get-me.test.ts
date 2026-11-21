import type { ModuleName } from '@modivara/core-contracts';
import { expect, it } from 'vitest';
import { Entitlement } from '../domain/index.js';
import { World } from '../testing/index.js';
import { GetMe } from './get-me.js';

/** Deja a Bar Sol exactamente con estos módulos habilitados. */
async function solWith(modules: ModuleName[]) {
  const w = await World.create();
  for (const e of w.entitlements.items.filter((x) => x.organizationId === w.sol.id)) e.setEnabled(modules.includes(e.module));
  for (const m of modules) if (!(await w.entitlements.find({ organizationId: w.sol.id, module: m }))) await w.entitlements.save(Entitlement.create({ organizationId: w.sol.id, module: m }));
  const getMe = new GetMe(w.users, w.organizations, w.locations, w.memberships, w.entitlements);
  return { w, getMe };
}

it('solo hospitality: sin permisos de commerce ni analytics', async () => {
  const { w, getMe } = await solWith(['hospitality']);
  const me = await getMe.execute({ actor: w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true })) });
  expect(me.modules).toEqual(['hospitality']);
  expect(me.locations[0]!.permissions).toEqual([
    'core.users.manage', 'hospitality.tables.manage', 'hospitality.tables.link_sale', 'hospitality.calls.read', 'hospitality.calls.acknowledge',
    'hospitality.calls.complete', 'hospitality.devices.status',
  ]);
});

it('commerce + analytics: métricas de inventario sí, de llamados no (sin fuente hospitality)', async () => {
  const { w, getMe } = await solWith(['commerce', 'analytics']);
  const me = await getMe.execute({ actor: w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true })) });
  expect(me.locations[0]!.permissions).toEqual([
    'core.users.manage', 'commerce.catalog.manage', 'commerce.reasons.manage', 'commerce.stock.read', 'commerce.stock.write',
    'analytics.inventory.read',
  ]);
});

it('hospitality + analytics: métricas de llamados sí, de inventario no', async () => {
  const { w, getMe } = await solWith(['hospitality', 'analytics']);
  const me = await getMe.execute({ actor: w.actorOf(await w.addUser(w.sol, 'inv', { roles: ['inventory'], location: w.solCenter })) });
  expect(me.locations[0]!.permissions).toEqual([]);
  const admin = await getMe.execute({ actor: w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true })) });
  expect(admin.locations[0]!.permissions).toContain('analytics.calls.read');
  expect(admin.locations[0]!.permissions).not.toContain('analytics.inventory.read');
});

it('superadmin actuando sobre un negocio conserva platform.* y pierde los módulos ausentes', async () => {
  const { w, getMe } = await solWith(['hospitality']);
  const root = await w.addUser(w.platform, 'root');
  const me = await getMe.execute({ actor: w.actorOf(root, { actingOrganizationId: w.sol.id }) });
  const perms = me.locations[0]!.permissions;
  expect(perms).toContain('platform.gateways.manage');
  expect(perms).toContain('hospitality.calls.read');
  expect(perms.some((p) => p.startsWith('commerce.') || p.startsWith('analytics.'))).toBe(false);
});

it('cajero: permisos de pos solo si el negocio tiene pos', async () => {
  const sin = await solWith(['hospitality', 'commerce', 'analytics']);
  const caja = await sin.getMe.execute({ actor: sin.w.actorOf(await sin.w.addUser(sin.w.sol, 'caja', { roles: ['cashier'], location: sin.w.solCenter })) });
  expect(caja.locations[0]!.permissions).toEqual(['hospitality.tables.link_sale']); // sin pos no vende; el permiso de mesa es de Hospitality
  const con = await solWith(['pos']);
  const caja2 = await con.getMe.execute({ actor: con.w.actorOf(await con.w.addUser(con.w.sol, 'caja', { roles: ['cashier'], location: con.w.solCenter })) });
  expect(caja2.locations[0]!.permissions).toEqual(['pos.sales.operate', 'pos.sales.read']); // sin Hospitality no hay link_sale (POS-only no vincula)
});
