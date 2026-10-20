import { findManageableUser, type ActorContext } from './actor.js';
import type { MembershipRepository, SessionRepository, UserRepository } from './ports/index.js';

export class RevokeUserSessions {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly sessions: SessionRepository,
  ) {}

  async execute(input: { actor: ActorContext; userId: string }): Promise<void> {
    const user = await findManageableUser(input.actor, input.userId, { users: this.users, memberships: this.memberships });
    await this.sessions.revokeAllForUser(user.id, new Date());
  }
}
