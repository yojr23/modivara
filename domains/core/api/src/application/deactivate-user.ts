import { newId } from '@modivara/core-contracts';
import { findManageableUser, type ActorContext } from './actor.js';
import type { AuditLog, MembershipRepository, SessionRepository, UserRepository } from './ports/index.js';

export class DeactivateUser {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditLog,
  ) {}

  async execute(input: { actor: ActorContext; userId: string }): Promise<void> {
    const user = await findManageableUser(input.actor, input.userId, { users: this.users, memberships: this.memberships });
    const now = new Date();
    user.deactivate(now);
    await this.users.save(user);
    await this.sessions.revokeAllForUser({ organizationId: user.organizationId, userId: user.id }, now);
    // ponytail: hoy se escribe tras el cambio, sin atomicidad; el adaptador Prisma debe registrarlo en la misma transacción.
    await this.audit.record({
      id: newId(),
      organizationId: user.organizationId,
      actorUserId: input.actor.actorUserId,
      action: 'user.deactivated',
      targetType: 'user',
      targetId: user.id,
      details: { username: user.username },
      occurredAt: new Date(),
    });
  }
}
