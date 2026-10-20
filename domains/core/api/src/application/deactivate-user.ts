import { newId } from '@modivara/core-contracts';
import { findManageableUser, type ActorContext } from './actor.js';
import type { AdminTransactions } from './ports/index.js';

export class DeactivateUser {
  constructor(private readonly admin: AdminTransactions) {}

  execute(input: { actor: ActorContext; userId: string }): Promise<void> {
    return this.admin.withTransaction(async (tx) => {
      const user = await findManageableUser(input.actor, input.userId, tx);
      const now = new Date();
      user.deactivate(now);
      await tx.users.save(user);
      await tx.sessions.revokeAllForUser({ organizationId: user.organizationId, userId: user.id }, now);
      await tx.audit.record({
        id: newId(),
        organizationId: user.organizationId,
        actorUserId: input.actor.actorUserId,
        action: 'user.deactivated',
        targetType: 'user',
        targetId: user.id,
        details: { username: user.username },
        occurredAt: new Date(),
      });
    });
  }
}
