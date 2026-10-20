import { newId, NotFoundError } from '@modivara/core-contracts';
import { LocationMembership } from '../domain/index.js';
import { findManageableUser, type ActorContext } from './actor.js';
import type { LocationRepository, MembershipRepository, UserRepository } from './ports/index.js';

export class SetLocationRoles {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly locations: LocationRepository,
  ) {}

  // OPEN: ¿cómo se quita a alguien de un local? Los roles no pueden quedar vacíos; no hay caso de uso de baja de membresía.
  async execute(input: { actor: ActorContext; userId: string; locationId: string; roles: readonly string[] }): Promise<LocationMembership> {
    const user = await findManageableUser(input.actor, input.userId, { users: this.users, memberships: this.memberships });
    const location = await this.locations.findById(input.locationId);
    // Un local de otro negocio responde "no existe"; la membresía además valida el mismo negocio.
    if (!location?.isActive || (!input.actor.isPlatform && location.organizationId !== input.actor.organizationId)) {
      throw new NotFoundError('Location');
    }

    const existing = await this.memberships.findActive(user.id, location.id);
    if (existing) {
      existing.setRoles(input.roles);
      await this.memberships.save(existing);
      return existing;
    }
    const created = LocationMembership.create({ id: newId(), user, location, roles: input.roles });
    await this.memberships.save(created);
    return created;
  }
}
