import { newId } from '@modivara/core-contracts';
import { assertPasswordPolicy } from '../domain/index.js';
import { findManageableUser, type ActorContext } from './actor.js';
import type { AdminTransactions, PasswordHasher } from './ports/index.js';

/** Restablecimiento por admin del negocio o superadmin (ADR-002 D2: sin correo). */
export class ResetPassword {
  constructor(
    private readonly admin: AdminTransactions,
    private readonly hasher: PasswordHasher,
  ) {}

  execute(input: { actor: ActorContext; userId: string; newPassword: string }): Promise<void> {
    return this.admin.withTransaction(async (tx) => {
      const user = await findManageableUser(input.actor, input.userId, tx);
      assertPasswordPolicy(input.newPassword);
      const now = new Date();
      user.changePassword(await this.hasher.hash(input.newPassword), now);
      await tx.users.save(user);
      await tx.sessions.revokeAllForUser({ organizationId: user.organizationId, userId: user.id }, now);
      await tx.audit.record({
        id: newId(),
        organizationId: user.organizationId,
        actorUserId: input.actor.actorUserId,
        action: 'user.password_reset',
        targetType: 'user',
        targetId: user.id,
        details: { username: user.username },
        occurredAt: new Date(),
      });
    });
  }
}
