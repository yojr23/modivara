import { newId } from '@modivara/core-contracts';
import { findManageableUser, type ActorContext } from './actor.js';
import type { AuditLog, MembershipRepository, SessionRepository, UserRepository } from './ports/index.js';

export class RevokeUserSessions {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditLog,
  ) {}

  async execute(input: { actor: ActorContext; userId: string }): Promise<void> {
    const user = await findManageableUser(input.actor, input.userId, { users: this.users, memberships: this.memberships });
    await this.sessions.revokeAllForUser({ organizationId: user.organizationId, userId: user.id }, new Date());
    // ponytail: hoy se escribe tras el cambio, sin atomicidad; el adaptador Prisma debe registrarlo en la misma transacción.
    await this.audit.record({
      id: newId(),
      organizationId: user.organizationId,
      actorUserId: input.actor.actorUserId,
      action: 'user.sessions_revoked',
      targetType: 'user',
      targetId: user.id,
      details: { username: user.username },
      occurredAt: new Date(),
    });
  }
}
