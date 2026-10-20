import { PermissionDeniedError, type AppUser } from '../domain/index.js';
import { assertCanManageUsers, effectiveOrganizationId, type ActorContext } from './actor.js';
import type { MembershipRepository, UserRepository } from './ports/index.js';

export class ListUsers {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  /** Usuarios activos del negocio del actor (el superadmin, del negocio elegido o del indicado). */
  async execute(input: { actor: ActorContext; organizationId?: string }): Promise<AppUser[]> {
    const { actor } = input;
    await assertCanManageUsers(actor, this.memberships);
    if (input.organizationId && !actor.isPlatform) throw new PermissionDeniedError('Cannot list users of another organization');
    return this.users.listActive({ organizationId: input.organizationId ?? effectiveOrganizationId(actor) });
  }
}
