import { newId, NotFoundError } from '@modivara/core-contracts';
import { assertPasswordPolicy, InvalidCredentialsError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AdminTransactions, PasswordHasher } from './ports/index.js';

export class ChangePassword {
  constructor(
    private readonly admin: AdminTransactions,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Contraseña, revocación de sesiones y auditoría confirman o revierten juntas (como `ResetPassword`). */
  execute(input: { actor: ActorContext; currentPassword: string; newPassword: string }): Promise<void> {
    return this.admin.withTransaction(async (tx) => {
      const user = await tx.users.findById({ id: input.actor.actorUserId, organizationId: input.actor.organizationId });
      if (!user?.isActive) throw new NotFoundError('User');
      assertPasswordPolicy(input.newPassword);
      if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) throw new InvalidCredentialsError();

      const now = new Date();
      user.changePassword(await this.hasher.hash(input.newPassword), now);
      await tx.users.save(user);
      await tx.sessions.revokeAllForUser({ organizationId: user.organizationId, userId: user.id }, now);
      await tx.audit.record({
        id: newId(),
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'user.password_changed',
        targetType: 'user',
        targetId: user.id,
        details: { username: user.username },
        occurredAt: now,
      });
    });
  }
}
