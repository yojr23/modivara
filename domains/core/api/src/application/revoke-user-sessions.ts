import { newId } from '@modivara/core-contracts';
import { findManageableUser, type ActorContext } from './actor.js';
import type { AdminTransactions } from './ports/index.js';

export class RevokeUserSessions {
  constructor(private readonly admin: AdminTransactions) {}

  execute(input: { actor: ActorContext; userId: string }): Promise<void> {
    return this.admin.withTransaction(async (tx) => {
      const user = await findManageableUser(input.actor, input.userId, tx, { allowSelf: true });
      await tx.sessions.revokeAllForUser({ organizationId: user.organizationId, userId: user.id }, new Date());
      await tx.audit.record({
        id: newId(),
        organizationId: user.organizationId,
        actorUserId: input.actor.actorUserId,
        action: 'user.sessions_revoked',
        targetType: 'user',
        targetId: user.id,
        details: { username: user.username },
        occurredAt: new Date(),
      });
    });
  }
}
