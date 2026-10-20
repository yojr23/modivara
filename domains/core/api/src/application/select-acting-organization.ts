import { newId, NotFoundError } from '@modivara/core-contracts';
import { PermissionDeniedError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AdminTransactions } from './ports/index.js';

export class SelectActingOrganization {
  constructor(private readonly admin: AdminTransactions) {}

  /** `null` vuelve a operar sobre la organización propia. Devuelve el actor ya actualizado. */
  execute(input: { actor: ActorContext; organizationId: string | null }): Promise<ActorContext> {
    return this.admin.withTransaction(async (tx) => {
      const { actor } = input;
      if (!actor.isPlatform) throw new PermissionDeniedError('Only platform users can select an organization');
      if (input.organizationId) {
        const org = await tx.organizations.findById({ id: input.organizationId });
        if (!org?.isActive) throw new NotFoundError('Organization');
      }
      const session = await tx.sessions.findById({ id: actor.sessionId, userId: actor.actorUserId });
      if (!session) throw new NotFoundError('Session');
      const previous = session.actingOrganizationId;
      session.actAs(input.organizationId, actor);
      await tx.sessions.save(session);
      await tx.audit.record({
        id: newId(),
        // Negocio afectado: el elegido o, al volver a la propia, el que se dejó.
        organizationId: input.organizationId ?? previous ?? actor.organizationId,
        actorUserId: actor.actorUserId,
        action: 'session.acting_organization_selected',
        targetType: 'session',
        targetId: session.id,
        details: { previousOrganizationId: previous, organizationId: input.organizationId },
        occurredAt: new Date(),
      });
      return { ...actor, actingOrganizationId: input.organizationId };
    });
  }
}
