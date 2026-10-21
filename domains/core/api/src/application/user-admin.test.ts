import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '@modivara/core-contracts';
import {
  PermissionDeniedError,
  SessionInvalidError,
  WeakPasswordError,
  type AppUser,
} from '../domain/index.js';
import { newId } from '@modivara/core-contracts';
import { Location } from '../domain/index.js';
import { ListUsers } from './list-users.js';
import { TEST_PASSWORD, World } from '../testing/index.js';
import type { ActorContext } from './actor.js';
import { AuthenticateSession } from './authenticate-session.js';
import { CreateUser } from './create-user.js';
import { DeactivateUser } from './deactivate-user.js';
import { Login } from './login.js';
import { ResetPassword } from './reset-password.js';
import { RevokeUserSessions } from './revoke-user-sessions.js';
import { SetLocationRoles } from './set-location-roles.js';

describe('administración de usuarios', () => {
  let w: World;
  let owner: AppUser, admin: AppUser, staff: AppUser, lunaOwner: AppUser, root: AppUser;
  let ownerCtx: ActorContext, adminCtx: ActorContext, staffCtx: ActorContext, lunaCtx: ActorContext, rootCtx: ActorContext;
  let createUser: CreateUser, reset: ResetPassword, deactivate: DeactivateUser, revoke: RevokeUserSessions, setRoles: SetLocationRoles;

  beforeEach(async () => {
    w = await World.create();
    owner = await w.addUser(w.sol, 'duena', { isOwner: true });
    admin = await w.addUser(w.sol, 'jefe', { roles: ['admin'], location: w.solCenter });
    staff = await w.addUser(w.sol, 'mesero', { roles: ['staff'], location: w.solCenter });
    lunaOwner = await w.addUser(w.luna, 'luna', { isOwner: true });
    root = await w.addUser(w.platform, 'root');
    [ownerCtx, adminCtx, staffCtx, lunaCtx, rootCtx] = [owner, admin, staff, lunaOwner, root].map((u) => w.actorOf(u)) as [ActorContext, ActorContext, ActorContext, ActorContext, ActorContext];

    createUser = new CreateUser(w.admin, w.hasher);
    reset = new ResetPassword(w.admin, w.hasher);
    deactivate = new DeactivateUser(w.admin);
    revoke = new RevokeUserSessions(w.admin);
    setRoles = new SetLocationRoles(w.admin);
  });

  const newUser = (actor: ActorContext, extra: object = {}) =>
    createUser.execute({ actor, username: 'Nuevo.User', displayName: 'Nuevo', password: TEST_PASSWORD, ...extra });

  describe('CreateUser', () => {
    it('el dueño y el admin con core.users.manage crean usuarios en su negocio (username en minúsculas)', async () => {
      expect((await newUser(ownerCtx)).username).toBe('nuevo.user');
      const u = await createUser.execute({ actor: adminCtx, username: 'otro', displayName: 'Otro', password: TEST_PASSWORD });
      expect(u.organizationId).toBe(w.sol.id);
      expect(u.isOwner).toBe(false);
    });

    it('el staff no puede', async () => {
      await expect(newUser(staffCtx)).rejects.toThrow(PermissionDeniedError);
    });

    it('un negocio no crea usuarios en otro negocio', async () => {
      await expect(newUser(ownerCtx, { organizationId: w.luna.id })).rejects.toThrow(PermissionDeniedError);
    });

    it('un negocio cliente nunca crea superadmins (usuarios de la plataforma)', async () => {
      await expect(newUser(ownerCtx, { organizationId: w.platform.id })).rejects.toThrow(PermissionDeniedError);
    });

    it('solo el superadmin crea dueños', async () => {
      await expect(newUser(adminCtx, { isOwner: true })).rejects.toThrow(PermissionDeniedError);
      await expect(newUser(ownerCtx, { isOwner: true })).rejects.toThrow(PermissionDeniedError);
      const u = await newUser(rootCtx, { organizationId: w.sol.id, isOwner: true });
      expect(u.isOwner).toBe(true);
    });

    it('el superadmin crea usuarios en el negocio elegido o en la plataforma', async () => {
      const inLuna = await newUser({ ...rootCtx, actingOrganizationId: w.luna.id });
      expect(inLuna.organizationId).toBe(w.luna.id);
      const peer = await newUser(rootCtx, { username: 'otro-root' });
      expect(peer.organizationId).toBe(w.platform.id);
    });

    it('valida política, formato y unicidad por negocio', async () => {
      await expect(newUser(ownerCtx, { password: 'debil' })).rejects.toThrow(WeakPasswordError);
      await expect(newUser(ownerCtx, { username: 'x' })).rejects.toThrow(ValidationError);
      await expect(newUser(ownerCtx, { username: 'jefe' })).rejects.toThrow(ConflictError);
      await expect(newUser(lunaCtx, { username: 'jefe' })).resolves.toBeDefined(); // otro negocio: permitido
    });

    it('rechaza negocios desactivados o inexistentes', async () => {
      w.luna.deactivate(new Date());
      await expect(newUser(rootCtx, { organizationId: w.luna.id })).rejects.toThrow(NotFoundError);
    });
  });

  describe('ResetPassword / DeactivateUser / RevokeUserSessions', () => {
    let login: Login;
    let authenticate: AuthenticateSession;
    beforeEach(() => {
      login = new Login(w.organizations, w.users, w.sessions, w.hasher, w.tokens);
      authenticate = new AuthenticateSession(w.sessions, w.users, w.organizations, w.tokens);
    });
    const meseroSession = () => login.execute({ slug: 'bar-sol', username: 'mesero', password: TEST_PASSWORD });

    it('el admin restablece la contraseña y se cierran las sesiones del usuario', async () => {
      const s = await meseroSession();
      await reset.execute({ actor: adminCtx, userId: staff.id, newPassword: 'Reinicio99' });
      await expect(authenticate.execute({ token: s.token })).rejects.toThrow(SessionInvalidError);
      await expect(login.execute({ slug: 'bar-sol', username: 'mesero', password: 'Reinicio99' })).resolves.toBeDefined();
    });

    it('el restablecimiento valida la política', async () => {
      await expect(reset.execute({ actor: adminCtx, userId: staff.id, newPassword: 'debil' })).rejects.toThrow(WeakPasswordError);
    });

    it('el staff no administra a nadie', async () => {
      await expect(reset.execute({ actor: staffCtx, userId: admin.id, newPassword: 'Reinicio99' })).rejects.toThrow(PermissionDeniedError);
      await expect(deactivate.execute({ actor: staffCtx, userId: admin.id })).rejects.toThrow(PermissionDeniedError);
      await expect(revoke.execute({ actor: staffCtx, userId: admin.id })).rejects.toThrow(PermissionDeniedError);
    });

    it('aislamiento: el dueño de otro negocio ve un usuario ajeno como inexistente', async () => {
      await expect(reset.execute({ actor: lunaCtx, userId: staff.id, newPassword: 'Reinicio99' })).rejects.toThrow(NotFoundError);
      await expect(deactivate.execute({ actor: lunaCtx, userId: staff.id })).rejects.toThrow(NotFoundError);
      await expect(revoke.execute({ actor: lunaCtx, userId: staff.id })).rejects.toThrow(NotFoundError);
      await expect(reset.execute({ actor: ownerCtx, userId: root.id, newPassword: 'Reinicio99' })).rejects.toThrow(NotFoundError);
    });

    it('el superadmin administra usuarios de cualquier negocio', async () => {
      await reset.execute({ actor: { ...rootCtx, actingOrganizationId: w.sol.id }, userId: staff.id, newPassword: 'Reinicio99' });
      await deactivate.execute({ actor: { ...rootCtx, actingOrganizationId: w.luna.id }, userId: lunaOwner.id });
      expect(lunaOwner.isActive).toBe(false);
    });

    it('desactivar revoca sesiones e impide volver a entrar', async () => {
      const s = await meseroSession();
      await deactivate.execute({ actor: ownerCtx, userId: staff.id });
      await expect(authenticate.execute({ token: s.token })).rejects.toThrow(SessionInvalidError);
      await expect(meseroSession()).rejects.toThrow();
    });

    it('revocar sesiones deja la cuenta utilizable', async () => {
      const s = await meseroSession();
      await revoke.execute({ actor: adminCtx, userId: staff.id });
      await expect(authenticate.execute({ token: s.token })).rejects.toThrow(SessionInvalidError);
      await expect(meseroSession()).resolves.toBeDefined();
    });
  });

  describe('SetLocationRoles', () => {
    it('crea y luego actualiza la membresía', async () => {
      const first = await setRoles.execute({ actor: ownerCtx, userId: staff.id, locationId: w.solCenter.id, roles: ['inventory'] });
      expect(first.roles).toEqual(['inventory']);
      const again = await setRoles.execute({ actor: ownerCtx, userId: staff.id, locationId: w.solCenter.id, roles: ['staff', 'inventory'] });
      expect(again.id).toBe(first.id);
      expect(again.roles).toEqual(['staff', 'inventory']);
    });

    it('no asigna locales de otro negocio ni usuarios de otro negocio', async () => {
      await expect(setRoles.execute({ actor: ownerCtx, userId: staff.id, locationId: w.lunaCenter.id, roles: ['staff'] })).rejects.toThrow(NotFoundError);
      await expect(setRoles.execute({ actor: lunaCtx, userId: staff.id, locationId: w.lunaCenter.id, roles: ['staff'] })).rejects.toThrow(NotFoundError);
    });

    it('ni siquiera el superadmin cruza negocios en una membresía', async () => {
      const acting = { ...rootCtx, actingOrganizationId: w.sol.id };
      await expect(setRoles.execute({ actor: acting, userId: staff.id, locationId: w.lunaCenter.id, roles: ['staff'] })).rejects.toThrow(NotFoundError);
      await expect(setRoles.execute({ actor: rootCtx, userId: staff.id, locationId: w.solCenter.id, roles: ['staff'] })).rejects.toThrow(NotFoundError); // sin negocio elegido no ve usuarios ajenos
    });

    it('exige permiso y roles válidos', async () => {
      await expect(setRoles.execute({ actor: staffCtx, userId: staff.id, locationId: w.solCenter.id, roles: ['admin'] })).rejects.toThrow(PermissionDeniedError);
      await expect(setRoles.execute({ actor: ownerCtx, userId: staff.id, locationId: w.solCenter.id, roles: [] })).rejects.toThrow(ValidationError);
    });
  });

  describe('alcance por local (sin toma lateral de cuentas)', () => {
    let terraza: Location;
    let adminA: AppUser, adminB: AppUser, staffB: AppUser, both: AppUser, ctxA: ActorContext, ctxB: ActorContext, ctxBoth: ActorContext;
    beforeEach(async () => {
      terraza = Location.create({ id: newId(), organizationId: w.sol.id, name: 'Terraza' });
      await w.locations.save(terraza);
      adminA = admin; // admin en Centro (local A)
      adminB = await w.addUser(w.sol, 'jefeb', { roles: ['admin'], location: terraza });
      staffB = await w.addUser(w.sol, 'meserob', { roles: ['staff'], location: terraza });
      both = await w.addUser(w.sol, 'ambos', { roles: ['admin'], location: w.solCenter });
      await setRoles.execute({ actor: ownerCtx, userId: both.id, locationId: terraza.id, roles: ['admin'] });
      [ctxA, ctxB, ctxBoth] = [adminA, adminB, both].map((u) => w.actorOf(u)) as [ActorContext, ActorContext, ActorContext];
    });

    it('el admin del local A no gestiona al admin ni al staff del local B (404)', async () => {
      for (const target of [adminB, staffB]) {
        await expect(reset.execute({ actor: ctxA, userId: target.id, newPassword: 'Reinicio99' })).rejects.toThrow(NotFoundError);
        await expect(deactivate.execute({ actor: ctxA, userId: target.id })).rejects.toThrow(NotFoundError);
        await expect(revoke.execute({ actor: ctxA, userId: target.id })).rejects.toThrow(NotFoundError);
        await expect(setRoles.execute({ actor: ctxA, userId: target.id, locationId: w.solCenter.id, roles: ['staff'] })).rejects.toThrow(NotFoundError);
      }
      expect(adminB.isActive).toBe(true);
    });

    it('con membresía en ambos locales se gestiona a los de cualquiera; el dueño y el superadmin, a todos', async () => {
      await reset.execute({ actor: ctxBoth, userId: staffB.id, newPassword: 'Reinicio99' });
      await reset.execute({ actor: ctxA, userId: both.id, newPassword: 'Reinicio99' }); // comparten Centro
      await reset.execute({ actor: ownerCtx, userId: adminB.id, newPassword: 'Reinicio99' });
      await reset.execute({ actor: { ...rootCtx, actingOrganizationId: w.sol.id }, userId: staffB.id, newPassword: 'Reinicio99' });
    });

    it('asignar roles exige core.users.manage en ESE local', async () => {
      await expect(setRoles.execute({ actor: ctxA, userId: staff.id, locationId: terraza.id, roles: ['staff'] })).rejects.toThrow(PermissionDeniedError);
      await expect(setRoles.execute({ actor: ctxBoth, userId: staff.id, locationId: terraza.id, roles: ['staff'] })).resolves.toBeDefined();
      await expect(setRoles.execute({ actor: ctxA, userId: staff.id, locationId: w.solCenter.id, roles: ['inventory'] })).resolves.toBeDefined();
    });

    it('un usuario recién creado (sin membresías) se puede asignar a un local propio, no restablecer', async () => {
      const fresh = await newUser(ctxA);
      await expect(reset.execute({ actor: ctxA, userId: fresh.id, newPassword: 'Reinicio99' })).rejects.toThrow(NotFoundError);
      await expect(setRoles.execute({ actor: ctxA, userId: fresh.id, locationId: w.solCenter.id, roles: ['staff'] })).resolves.toBeDefined();
      await expect(reset.execute({ actor: ctxA, userId: fresh.id, newPassword: 'Reinicio99' })).resolves.toBeUndefined();
    });

    it('el listado solo muestra a quienes el admin alcanza', async () => {
      const list = new ListUsers(w.users, w.memberships);
      const names = async (actor: ActorContext) => (await list.execute({ actor })).map((u) => u.username);
      expect(await names(ctxA)).toEqual(['ambos', 'jefe', 'mesero']);
      expect(await names(ctxB)).toEqual(['ambos', 'jefeb', 'meserob']);
      expect((await names(ownerCtx)).length).toBe(6);
    });
  });

  describe('auditoría', () => {
    const last = () => w.audit.entries.at(-1)!;

    it('CreateUser registra user.created en el negocio afectado, sin secretos', async () => {
      const u = await newUser({ ...rootCtx, actingOrganizationId: w.luna.id });
      expect(last()).toMatchObject({ organizationId: w.luna.id, actorUserId: root.id, action: 'user.created', targetType: 'user', targetId: u.id });
      expect(JSON.stringify(last())).not.toMatch(/fake:|Secret/);
    });

    it('deactivate, reset y revoke registran su acción con el negocio del usuario', async () => {
      const rootInSol = { ...rootCtx, actingOrganizationId: w.sol.id };
      await reset.execute({ actor: rootInSol, userId: staff.id, newPassword: 'Reinicio99' });
      expect(last()).toMatchObject({ organizationId: w.sol.id, actorUserId: root.id, action: 'user.password_reset', targetId: staff.id });
      await revoke.execute({ actor: rootInSol, userId: staff.id });
      expect(last()).toMatchObject({ organizationId: w.sol.id, action: 'user.sessions_revoked', targetId: staff.id });
      await deactivate.execute({ actor: rootInSol, userId: staff.id });
      expect(last()).toMatchObject({ organizationId: w.sol.id, action: 'user.deactivated', targetId: staff.id });
      expect(JSON.stringify(w.audit.entries)).not.toMatch(/Reinicio99|fake:/);
    });

    it('SetLocationRoles registra membership.roles_set con los roles', async () => {
      const m = await setRoles.execute({ actor: ownerCtx, userId: staff.id, locationId: w.solCenter.id, roles: ['inventory'] });
      expect(last()).toMatchObject({
        organizationId: w.sol.id, action: 'membership.roles_set', targetType: 'membership', targetId: m.id,
        details: { userId: staff.id, locationId: w.solCenter.id, roles: ['inventory'] },
      });
    });

    it('una acción rechazada no deja rastro', async () => {
      await expect(reset.execute({ actor: staffCtx, userId: admin.id, newPassword: 'Reinicio99' })).rejects.toThrow(PermissionDeniedError);
      await expect(newUser(ownerCtx, { username: 'jefe' })).rejects.toThrow(ConflictError);
      expect(w.audit.entries).toHaveLength(0);
    });
  });
});

describe('atomicidad con auditoría', () => {
  it('si falla la auditoría, el cambio no se aplica (doble en memoria con rollback)', async () => {
    const w = await World.create();
    const owner = w.actorOf(await w.addUser(w.sol, 'duena', { isOwner: true }));
    w.audit.record = () => Promise.reject(new Error('audit down'));
    await expect(
      new CreateUser(w.admin, w.hasher).execute({ actor: owner, username: 'nuevo', displayName: 'N', password: TEST_PASSWORD }),
    ).rejects.toThrow('audit down');
    expect(await w.users.findActiveByUsername({ organizationId: w.sol.id, username: 'nuevo' })).toBeNull();
  });
});

describe('protección de cuentas de dueños y de la cuenta propia', () => {
  let w: World;
  let owner: AppUser, owner2: AppUser, admin: AppUser, root: AppUser;
  let ctx: Record<string, ActorContext>;
  let reset: ResetPassword, deactivate: DeactivateUser, revoke: RevokeUserSessions, setRoles: SetLocationRoles;

  beforeEach(async () => {
    w = await World.create();
    owner = await w.addUser(w.sol, 'duena', { isOwner: true });
    owner2 = await w.addUser(w.sol, 'duena2', { isOwner: true });
    admin = await w.addUser(w.sol, 'jefe', { roles: ['admin'], location: w.solCenter });
    root = await w.addUser(w.platform, 'root');
    ctx = {
      owner: w.actorOf(owner), admin: w.actorOf(admin), root: w.actorOf(root, { actingOrganizationId: w.sol.id }),
    } as Record<string, ActorContext>;
    reset = new ResetPassword(w.admin, w.hasher);
    deactivate = new DeactivateUser(w.admin);
    revoke = new RevokeUserSessions(w.admin);
    setRoles = new SetLocationRoles(w.admin);
  });

  it('un admin no dueño no gestiona a un dueño (reset, desactivar, revocar, roles) -> NotFound', async () => {
    const a = ctx.admin!;
    await expect(reset.execute({ actor: a, userId: owner.id, newPassword: 'Nueva1234' })).rejects.toThrow(NotFoundError);
    await expect(deactivate.execute({ actor: a, userId: owner.id })).rejects.toThrow(NotFoundError);
    await expect(revoke.execute({ actor: a, userId: owner.id })).rejects.toThrow(NotFoundError);
    await expect(setRoles.execute({ actor: a, userId: owner.id, locationId: w.solCenter.id, roles: ['staff'] })).rejects.toThrow(NotFoundError);
    expect(owner.isActive).toBe(true);
    expect(w.audit.entries).toHaveLength(0);
  });

  it('un dueño gestiona a otro dueño del mismo negocio; el superadmin también', async () => {
    await reset.execute({ actor: ctx.owner!, userId: owner2.id, newPassword: 'Nueva1234' });
    await setRoles.execute({ actor: ctx.root!, userId: owner2.id, locationId: w.solCenter.id, roles: ['staff'] });
    await deactivate.execute({ actor: ctx.root!, userId: owner2.id });
    expect(owner2.isActive).toBe(false);
  });

  it('nadie se desactiva, se cambia los roles ni se restablece la contraseña a sí mismo', async () => {
    for (const [actor, me] of [[ctx.admin!, admin], [ctx.owner!, owner]] as const) {
      await expect(deactivate.execute({ actor, userId: me.id })).rejects.toThrow(PermissionDeniedError);
      await expect(reset.execute({ actor, userId: me.id, newPassword: 'Nueva1234' })).rejects.toThrow(PermissionDeniedError);
      await expect(setRoles.execute({ actor, userId: me.id, locationId: w.solCenter.id, roles: ['staff'] })).rejects.toThrow(PermissionDeniedError);
    }
    expect(admin.isActive && owner.isActive).toBe(true);
    await revoke.execute({ actor: ctx.admin!, userId: admin.id }); // cerrar las propias sesiones sí
  });
});
