import { PermissionDeniedError, type AppUser, type LocationMembership } from '../domain/index.js';
import { assertCanManageUsers, effectiveOrganizationId, manageLocationIds, type ActorContext } from './actor.js';
import type { MembershipRepository, UserRepository } from './ports/index.js';

export interface ListedUser { user: AppUser; memberships: LocationMembership[] }

export class ListUsers {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  /**
   * Usuarios activos del negocio del actor (el superadmin, del negocio elegido o del indicado); `includeInactive` añade los desactivados.
   * Cada uno con sus membresías activas en los locales que el actor ve (dueño/superadmin: todos; admin: donde tiene `core.users.manage`).
   */
  async execute(input: { actor: ActorContext; organizationId?: string; includeInactive?: boolean }): Promise<ListedUser[]> {
    const { actor } = input;
    await assertCanManageUsers(actor, this.memberships);
    if (input.organizationId && !actor.isPlatform) throw new PermissionDeniedError('Cannot list users of another organization');
    const ref = { organizationId: input.organizationId ?? effectiveOrganizationId(actor) };
    const all = await (input.includeInactive ? this.users.listAll(ref) : this.users.listActive(ref));
    const rows = await this.memberships.listActiveByUsers({ ...ref, userIds: all.map((u) => u.id) });
    const byUser = (u: AppUser) => rows.filter((m) => m.userId === u.id);
    if (actor.isPlatform || actor.isOwner) return all.map((user) => ({ user, memberships: byUser(user) }));
    // Misma regla que `canReachUser` (con `allowUnassigned`), sobre las membresías ya cargadas.
    const mine = await manageLocationIds(actor, this.memberships);
    return all.flatMap((user) => {
      const theirs = byUser(user);
      const visible = theirs.filter((m) => mine.has(m.locationId));
      const reach = user.id === actor.actorUserId || (!user.isOwner && (theirs.length === 0 || visible.length > 0));
      return reach ? [{ user, memberships: visible }] : [];
    });
  }
}
