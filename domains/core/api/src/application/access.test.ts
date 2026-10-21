import { beforeEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '@modivara/core-contracts';
import { PermissionDeniedError } from '../domain/index.js';
import { World } from '../testing/index.js';
import { CoreAccessService } from './core-access.service.js';
import { ResolveLocationAccess } from './resolve-location-access.js';
import { SelectActingOrganization } from './select-acting-organization.js';
import { Session } from '../domain/index.js';

describe('acceso a locales', () => {
  let w: World;
  let resolve: ResolveLocationAccess;
  beforeEach(async () => {
    w = await World.create();
    resolve = new ResolveLocationAccess(w.locations, w.memberships, w.entitlements);
  });

  it('staff: permisos de su rol y módulos habilitados del negocio', async () => {
    const staff = await w.addUser(w.sol, 'mesero', { roles: ['staff'], location: w.solCenter });
    const r = await resolve.execute({ actor: w.actorOf(staff), locationId: w.solCenter.id });
    expect(r.permissions.has('hospitality.calls.complete')).toBe(true);
    expect(r.permissions.has('hospitality.tables.manage')).toBe(false);
    expect(r.modules).toEqual(['hospitality']); // commerce está deshabilitado
    expect(r.location).toEqual({ id: w.solCenter.id, organizationId: w.sol.id, timezone: 'America/Bogota', active: true });
  });

  it('el dueño es admin en cualquier local de su negocio sin membresía', async () => {
    const owner = await w.addUser(w.sol, 'duena', { isOwner: true });
    const r = await resolve.execute({ actor: w.actorOf(owner), locationId: w.solCenter.id });
    expect(r.permissions.has('core.users.manage')).toBe(true);
    expect(r.permissions.has('platform.organizations.manage')).toBe(false);
  });

  it('sin membresía ni dueño: sin permisos', async () => {
    const nobody = await w.addUser(w.sol, 'nadie');
    const r = await resolve.execute({ actor: w.actorOf(nobody), locationId: w.solCenter.id });
    expect(r.permissions.size).toBe(0);
  });

  it('aislamiento: un usuario no accede a locales de otro negocio, ni siendo dueño', async () => {
    const lunaOwner = await w.addUser(w.luna, 'luna', { isOwner: true });
    await expect(resolve.execute({ actor: w.actorOf(lunaOwner), locationId: w.solCenter.id })).rejects.toThrow(NotFoundError);
  });

  it('un local desactivado no se resuelve', async () => {
    const owner = await w.addUser(w.sol, 'duena', { isOwner: true });
    w.solCenter.deactivate(new Date());
    await expect(resolve.execute({ actor: w.actorOf(owner), locationId: w.solCenter.id })).rejects.toThrow(NotFoundError);
  });

  it('D7: un local activo de un negocio desactivado no se resuelve (misma regla que CoreAccessService)', async () => {
    const owner = await w.addUser(w.sol, 'duena', { isOwner: true });
    w.sol.deactivate(new Date());
    await expect(resolve.execute({ actor: w.actorOf(owner), locationId: w.solCenter.id })).rejects.toThrow(NotFoundError);
  });

  it('superadmin: todos los permisos, solo en el negocio sobre el que opera', async () => {
    const root = await w.addUser(w.platform, 'root');
    const ctx = w.actorOf(root);
    await expect(resolve.execute({ actor: ctx, locationId: w.solCenter.id })).rejects.toThrow(NotFoundError);
    const r = await resolve.execute({ actor: { ...ctx, actingOrganizationId: w.sol.id }, locationId: w.solCenter.id });
    expect(r.permissions.has('platform.gateways.manage')).toBe(true);
    await expect(resolve.execute({ actor: { ...ctx, actingOrganizationId: w.sol.id }, locationId: w.lunaCenter.id })).rejects.toThrow(NotFoundError);
  });

  describe('SelectActingOrganization', () => {
    it('solo el superadmin; persiste en la sesión', async () => {
      const root = await w.addUser(w.platform, 'root');
      const ctx = w.actorOf(root);
      await w.sessions.create(Session.create({ id: ctx.sessionId, userId: root.id, tokenHash: 'h', now: new Date() }));
      const select = new SelectActingOrganization(w.admin);

      const updated = await select.execute({ actor: ctx, organizationId: w.sol.id });
      expect(updated.actingOrganizationId).toBe(w.sol.id);
      expect((await w.sessions.findById({ id: ctx.sessionId, userId: root.id }))!.actingOrganizationId).toBe(w.sol.id);
      expect((await select.execute({ actor: updated, organizationId: null })).actingOrganizationId).toBeNull();
      await expect(select.execute({ actor: ctx, organizationId: 'no-existe' })).rejects.toThrow(NotFoundError);

      expect(w.audit.entries.map((e) => [e.action, e.organizationId, e.targetId])).toEqual([
        ['session.acting_organization_selected', w.sol.id, ctx.sessionId],
        ['session.acting_organization_selected', w.sol.id, ctx.sessionId], // al volver a la propia, el negocio que se dejó
      ]);

      const owner = await w.addUser(w.sol, 'duena', { isOwner: true });
      await expect(select.execute({ actor: w.actorOf(owner), organizationId: w.luna.id })).rejects.toThrow(PermissionDeniedError);
    });
  });

  describe('CoreAccessService (CoreAccessPort)', () => {
    it('devuelve LocationRef o null', async () => {
      const port = new CoreAccessService(w.locations);
      expect(await port.getLocation(w.solCenter.id)).toEqual({ id: w.solCenter.id, organizationId: w.sol.id, timezone: 'America/Bogota', active: true });
      w.solCenter.deactivate(new Date());
      expect((await port.getLocation(w.solCenter.id))?.active).toBe(false);
      expect(await port.getLocation('x')).toBeNull();
    });

    it('local activo de un negocio desactivado: active false', async () => {
      const port = new CoreAccessService(w.locations);
      w.sol.deactivate(new Date());
      expect((await port.getLocation(w.solCenter.id))?.active).toBe(false);
    });
  });
});
