import { assertPasswordPolicy, InvalidCredentialsError, NotFoundError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { PasswordHasher, SessionRepository, UserRepository } from './ports/index.js';

export class ChangePassword {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: { actor: ActorContext; currentPassword: string; newPassword: string }): Promise<void> {
    const user = await this.users.findById(input.actor.actorUserId);
    if (!user?.isActive) throw new NotFoundError('User not found');
    assertPasswordPolicy(input.newPassword);
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) throw new InvalidCredentialsError();

    const now = new Date();
    user.changePassword(await this.hasher.hash(input.newPassword), now);
    await this.users.save(user);
    await this.sessions.revokeAllForUser(user.id, now);
  }
}
