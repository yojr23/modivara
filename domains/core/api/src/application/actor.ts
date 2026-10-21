import { effectiveOrganizationId, NotFoundError, permissionsFor, type Permission, type RequestActor } from '@modivara/core-contracts';
import { PermissionDeniedError, type AppUser } from '../domain/index.js';
import type { MembershipRepository, UserRepository } from './ports/index.js';

/** Quién hace la petición, ya autenticado (contrato `RequestActor` de core-contracts). */
export type ActorContext = RequestActor;
export { effectiveOrganizationId };

const MANAGE = 'core.users.manage' satisfies Permission;

/** Locales activos donde el actor (no dueño ni superadmin) tiene `core.users.manage`. */
async function manageLocationIds(actor: ActorContext, memberships: MembershipRepository): Promise<Set<string>> {
  const own = await memberships.listActiveByUser({ organizationId: actor.organizationId, userId: actor.actorUserId });
  return new Set(own.filter((m) => permissionsFor(m.roles, actor).has(MANAGE)).map((m) => m.locationId));
}

// OPEN: `core.users.manage` es por local. Dueños del negocio y superadmin gestionan a todos los usuarios del negocio; un admin no dueño
// solo a quienes tienen membresía activa en al menos un local donde él tiene `core.users.manage`, y asigna roles solo en esos locales
// (decisión conservadora, reversible: evita la toma lateral de cuentas entre locales). Quien aún no tiene membresías se puede listar y
// asignar a un local propio (alta en dos pasos), pero no se le restablece la contraseña ni se desactiva hasta que pertenezca a uno.
export async function canManageUsers(actor: ActorContext, memberships: MembershipRepository): Promise<boolean> {
  if (actor.isPlatform || actor.isOwner) return true;
  return (await manageLocationIds(actor, memberships)).size > 0;
}

export async function assertCanManageUsers(actor: ActorContext, memberships: MembershipRepository): Promise<void> {
  if (!(await canManageUsers(actor, memberships))) throw new PermissionDeniedError('core.users.manage required');
}

/** Para asignar roles: el actor debe tener `core.users.manage` en ESE local (dueño y superadmin, en todos). */
export async function assertCanManageUsersAt(actor: ActorContext, locationId: string, memberships: MembershipRepository): Promise<void> {
  if (actor.isPlatform || actor.isOwner) return;
  if (!(await manageLocationIds(actor, memberships)).has(locationId)) throw new PermissionDeniedError('core.users.manage required at this location');
}

/** ¿Alcanza el actor a este usuario? Dueño/superadmin, sí; admin, si comparten un local que él gestiona (o, con `allowUnassigned`, si no tiene ninguna membresía). */
export async function canReachUser(
  actor: ActorContext,
  target: AppUser,
  memberships: MembershipRepository,
  opts: { allowUnassigned?: boolean } = {},
): Promise<boolean> {
  if (actor.isPlatform || actor.isOwner || target.id === actor.actorUserId) return true;
  if (target.isOwner) return false; // los dueños son invisibles para un admin no dueño (como en findManageableUser)
  const theirs = await memberships.listActiveByUser({ organizationId: target.organizationId, userId: target.id });
  if (theirs.length === 0) return opts.allowUnassigned === true;
  const mine = await manageLocationIds(actor, memberships);
  return theirs.some((m) => mine.has(m.locationId));
}

/** Usuario que el actor puede administrar: del negocio sobre el que opera (el superadmin, el elegido). Otro negocio o fuera de su alcance responde "no existe". */
export async function findManageableUser(
  actor: ActorContext,
  userId: string,
  repos: { users: UserRepository; memberships: MembershipRepository },
  opts: { allowSelf?: boolean; allowUnassigned?: boolean } = {},
): Promise<AppUser> {
  await assertCanManageUsers(actor, repos.memberships);
  const user = await repos.users.findById({ id: userId, organizationId: effectiveOrganizationId(actor) });
  if (!user) throw new NotFoundError('User');
  // Cuenta propia: no se desactiva, no se cambian sus roles ni se restablece su contraseña (para eso, ChangePassword, que exige la actual).
  if (user.id === actor.actorUserId && !opts.allowSelf) throw new PermissionDeniedError('Cannot manage your own account here');
  // Un dueño solo lo gestiona otro dueño del negocio o el superadmin; para un admin no dueño "no existe" (no revelar).
  if (user.isOwner && !actor.isOwner && !actor.isPlatform) throw new NotFoundError('User');
  if (!(await canReachUser(actor, user, repos.memberships, opts))) throw new NotFoundError('User');
  return user;
}
