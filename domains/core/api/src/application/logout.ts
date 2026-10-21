import type { SessionRepository, SessionTokenService } from './ports/index.js';

export class Logout {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tokens: SessionTokenService,
  ) {}

  /** Idempotente: un token desconocido o ya revocado no es error. */
  async execute(input: { token: string }): Promise<void> {
    const session = await this.sessions.findByTokenHash({ tokenHash: this.tokens.hash(input.token) });
    if (!session) return;
    session.revoke(new Date());
    await this.sessions.revoke(session);
  }
}
