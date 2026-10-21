import { newId, NotFoundError } from '@modivara/core-contracts';
import { LocationMembership } from '../domain/index.js';
import { isLocationAvailable } from './location-availability.js';
import { assertCanManageUsersAt, findManageableUser, type ActorContext } from './actor.js';
import type { AdminTransactions } from './ports/index.js';

export class SetLocationRoles {
  constructor(private readonly admin: AdminTransactions) {}

  // OPEN: ¿cómo se quita a alguien de un local? Los roles no pueden quedar vacíos; no hay caso de uso de baja de membresía.
  execute(input: { actor: ActorContext; userId: string; locationId: string; roles: readonly string[] }): Promise<LocationMembership> {
    return this.admin.withTransaction(async (tx) => {
      const user = await findManageableUser(input.actor, input.userId, tx, { allowUnassigned: true });
      // Un local de otro negocio (que el del usuario) responde "no existe".
      const found = await tx.locations.findByIdWithOrganization({ id: input.locationId, organizationId: user.organizationId });
      if (!found || !isLocationAvailable(found)) throw new NotFoundError('Location');
      const { location } = found;
      await assertCanManageUsersAt(input.actor, location.id, tx.memberships);

      let membership = await tx.memberships.findActive({ organizationId: user.organizationId, userId: user.id, locationId: location.id });
      if (membership) {
        const before = [...membership.roles].sort().join();
        membership.setRoles(input.roles);
        // Mismos roles: nada que guardar ni auditar (el seed repite esta llamada).
        if ([...membership.roles].sort().join() === before) return membership;
      } else membership = LocationMembership.create({ id: newId(), user, location, roles: input.roles });
      await tx.memberships.save(membership);
      await tx.audit.record({
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
    });
  }
}
