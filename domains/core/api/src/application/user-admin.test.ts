import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  InvalidValueError,
  NotFoundError,
  PermissionDeniedError,
  SessionInvalidError,
  WeakPasswordError,
  type AppUser,
} from '../domain/index.js';
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

    createUser = new CreateUser(w.organizations, w.users, w.memberships, w.hasher);
    reset = new ResetPassword(w.users, w.memberships, w.sessions, w.hasher);
    deactivate = new DeactivateUser(w.users, w.memberships, w.sessions);
    revoke = new RevokeUserSessions(w.users, w.memberships, w.sessions);
    setRoles = new SetLocationRoles(w.users, w.memberships, w.locations);
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
      await expect(newUser(ownerCtx, { username: 'x' })).rejects.toThrow(InvalidValueError);
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
      await reset.execute({ actor: rootCtx, userId: staff.id, newPassword: 'Reinicio99' });
      await deactivate.execute({ actor: rootCtx, userId: lunaOwner.id });
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
      await expect(setRoles.execute({ actor: rootCtx, userId: staff.id, locationId: w.lunaCenter.id, roles: ['staff'] })).rejects.toThrow(InvalidValueError);
    });

    it('exige permiso y roles válidos', async () => {
      await expect(setRoles.execute({ actor: staffCtx, userId: staff.id, locationId: w.solCenter.id, roles: ['admin'] })).rejects.toThrow(PermissionDeniedError);
      await expect(setRoles.execute({ actor: ownerCtx, userId: staff.id, locationId: w.solCenter.id, roles: [] })).rejects.toThrow(InvalidValueError);
    });
  });
});
