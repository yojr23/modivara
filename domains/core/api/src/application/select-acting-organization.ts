import { NotFoundError } from '@modivara/core-contracts';
import { PermissionDeniedError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { OrganizationRepository, SessionRepository } from './ports/index.js';

export class SelectActingOrganization {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly sessions: SessionRepository,
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
    session.actAs(input.organizationId, actor);
    await this.sessions.save(session);
    return { ...actor, actingOrganizationId: input.organizationId };
  }
}
