import { newId, NotFoundError } from '@modivara/core-contracts';
import { LocationMembership } from '../domain/index.js';
import { isLocationAvailable } from './location-availability.js';
import { findManageableUser, type ActorContext } from './actor.js';
import type { AuditLog, LocationRepository, MembershipRepository, UserRepository } from './ports/index.js';

export class SetLocationRoles {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly locations: LocationRepository,
    private readonly audit: AuditLog,
  ) {}

  // OPEN: ¿cómo se quita a alguien de un local? Los roles no pueden quedar vacíos; no hay caso de uso de baja de membresía.
  async execute(input: { actor: ActorContext; userId: string; locationId: string; roles: readonly string[] }): Promise<LocationMembership> {
    const user = await findManageableUser(input.actor, input.userId, { users: this.users, memberships: this.memberships });
    // Un local de otro negocio (que el del usuario) responde "no existe".
    const found = await this.locations.findByIdWithOrganization({ id: input.locationId, organizationId: user.organizationId });
    if (!found || !isLocationAvailable(found)) throw new NotFoundError('Location');
    const { location } = found;

    let membership = await this.memberships.findActive({ organizationId: user.organizationId, userId: user.id, locationId: location.id });
    if (membership) membership.setRoles(input.roles);
    else membership = LocationMembership.create({ id: newId(), user, location, roles: input.roles });
    await this.memberships.save(membership);
    // ponytail: hoy se escribe tras el cambio, sin atomicidad; el adaptador Prisma debe registrarlo en la misma transacción.
    await this.audit.record({
      id: newId(),
      organizationId: user.organizationId,
      actorUserId: input.actor.actorUserId,
      action: 'membership.roles_set',
      targetType: 'membership',
      targetId: membership.id,
      details: { userId: user.id, locationId: location.id, roles: [...membership.roles] },
      occurredAt: new Date(),
    });
    return membership;
  }
}
