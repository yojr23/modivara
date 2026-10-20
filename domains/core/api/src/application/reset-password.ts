import { assertPasswordPolicy } from '../domain/index.js';
import { findManageableUser, type ActorContext } from './actor.js';
import type { MembershipRepository, PasswordHasher, SessionRepository, UserRepository } from './ports/index.js';

/** Restablecimiento por admin del negocio o superadmin (ADR-002 D2: sin correo). */
export class ResetPassword {
  constructor(
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: { actor: ActorContext; userId: string; newPassword: string }): Promise<void> {
    const user = await findManageableUser(input.actor, input.userId, { users: this.users, memberships: this.memberships });
    assertPasswordPolicy(input.newPassword);
    const now = new Date();
    user.changePassword(await this.hasher.hash(input.newPassword), now);
    await this.users.save(user);
    await this.sessions.revokeAllForUser(user.id, now);
  }
}
