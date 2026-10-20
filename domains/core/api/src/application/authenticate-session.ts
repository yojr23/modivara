import { SessionInvalidError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { OrganizationRepository, SessionRepository, SessionTokenService, UserRepository } from './ports/index.js';

export class AuthenticateSession {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
    private readonly tokens: SessionTokenService,
  ) {}

  async execute(input: { token: string }): Promise<ActorContext> {
    const now = new Date();
    const session = await this.sessions.findByTokenHash({ tokenHash: this.tokens.hash(input.token) });
    if (!session?.isValid(now)) throw new SessionInvalidError();

    const user = await this.users.findByIdForSession({ id: session.userId });
    const org = user ? await this.organizations.findById({ id: user.organizationId }) : null;
    if (!user?.isActive || !org?.isActive) throw new SessionInvalidError();

    if (session.touch(now)) await this.sessions.save(session);

    return {
      actorUserId: user.id,
      organizationId: user.organizationId,
      isPlatform: org.isPlatform,
      isOwner: user.isOwner,
      sessionId: session.id,
      actingOrganizationId: org.isPlatform ? session.actingOrganizationId : null,
    };
  }
}
