import { newId, NotFoundError } from '@modivara/core-contracts';
import { PermissionDeniedError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AuditLog, OrganizationRepository, SessionRepository } from './ports/index.js';

export class SelectActingOrganization {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditLog,
  ) {}

  /** `null` vuelve a operar sobre la organización propia. Devuelve el actor ya actualizado. */
  async execute(input: { actor: ActorContext; organizationId: string | null }): Promise<ActorContext> {
    const { actor } = input;
    if (!actor.isPlatform) throw new PermissionDeniedError('Only platform users can select an organization');
    if (input.organizationId) {
      const org = await this.organizations.findById({ id: input.organizationId });
      if (!org?.isActive) throw new NotFoundError('Organization');
    }
    const session = await this.sessions.findById({ id: actor.sessionId, userId: actor.actorUserId });
    if (!session) throw new NotFoundError('Session');
    const previous = session.actingOrganizationId;
    session.actAs(input.organizationId, actor);
    await this.sessions.save(session);
    // ponytail: hoy se escribe tras el cambio, sin atomicidad; el adaptador Prisma debe registrarlo en la misma transacción.
    await this.audit.record({
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
  }
}
