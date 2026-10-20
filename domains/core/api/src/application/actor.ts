import { permissionsFor, type Permission } from '@modivara/core-contracts';
import { NotFoundError, PermissionDeniedError, type AppUser } from '../domain/index.js';
import type { MembershipRepository, UserRepository } from './ports/index.js';

/** Quién hace la petición, ya autenticado. */
export interface ActorContext {
  actorUserId: string;
  organizationId: string;
  isPlatform: boolean;
  isOwner: boolean;
  sessionId: string;
  /** Solo superadmin: negocio sobre el que opera ahora. */
  actingOrganizationId: string | null;
}

/** Negocio sobre el que actúa: el propio, o el elegido si es superadmin. */
export function effectiveOrganizationId(actor: ActorContext): string {
  return actor.isPlatform ? (actor.actingOrganizationId ?? actor.organizationId) : actor.organizationId;
}

// OPEN: ¿`core.users.manage` es por local o por negocio? Se trata como por negocio:
// dueño, o admin en cualquier local, gestiona todos los usuarios del negocio.
export async function canManageUsers(actor: ActorContext, memberships: MembershipRepository): Promise<boolean> {
  if (actor.isPlatform || actor.isOwner) return true;
  const own = await memberships.listActiveByUser(actor.actorUserId);
  return own.some((m) => permissionsFor(m.roles, actor).has('core.users.manage' satisfies Permission));
}

export async function assertCanManageUsers(actor: ActorContext, memberships: MembershipRepository): Promise<void> {
  if (!(await canManageUsers(actor, memberships))) throw new PermissionDeniedError('core.users.manage required');
}

/** Usuario que el actor puede administrar: mismo negocio, salvo superadmin. Otro negocio responde "no existe". */
export async function findManageableUser(
  actor: ActorContext,
  userId: string,
  repos: { users: UserRepository; memberships: MembershipRepository },
): Promise<AppUser> {
  await assertCanManageUsers(actor, repos.memberships);
  const user = await repos.users.findById(userId);
  if (!user || (!actor.isPlatform && user.organizationId !== actor.organizationId)) throw new NotFoundError('User not found');
  return user;
}
