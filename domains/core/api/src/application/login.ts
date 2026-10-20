import { isValidUsername, newId } from '@modivara/core-contracts';
import { AccountLockedError, InvalidCredentialsError, Session } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { OrganizationRepository, PasswordHasher, SessionRepository, SessionTokenService, UserRepository } from './ports/index.js';

export interface LoginInput {
  slug: string;
  username: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}
export interface LoginOutput {
  /** Valor para la cookie; solo existe aquí, nunca se guarda. */
  token: string;
  expiresAt: Date;
  actor: ActorContext;
  displayName: string;
  username: string;
}

export class Login {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: SessionTokenService,
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const now = new Date();
    const username = input.username.trim().toLowerCase();
    const org = await this.organizations.findBySlug({ slug: input.slug.trim().toLowerCase() });
    const user = org?.isActive && isValidUsername(username) ? await this.users.findActiveByUsername({ organizationId: org.id, username }) : null;

    if (!org || !user) {
      // Trabajo equivalente al camino real para no delatar por tiempo si el usuario existe.
      await this.hasher.hash(input.password);
      throw new InvalidCredentialsError();
    }

    // OPEN: el bloqueo se informa de forma explícita (revela que el usuario existe). ¿Responder genérico también?
    const lockedUntil = user.lockedUntil(now);
    if (lockedUntil) throw new AccountLockedError(lockedUntil);

    if (!(await this.hasher.verify(user.passwordHash, input.password))) {
      user.registerFailedLogin(now);
      await this.users.save(user);
      throw new InvalidCredentialsError();
    }
    if (user.registerSuccessfulLogin()) await this.users.save(user);

    const { token, tokenHash } = this.tokens.generate();
    const session = Session.create({ id: newId(), userId: user.id, tokenHash, now, ip: input.ip, userAgent: input.userAgent });
    await this.sessions.save(session);

    return {
      token,
      expiresAt: session.expiresAt,
      displayName: user.displayName,
      username: user.username,
      actor: {
        actorUserId: user.id,
        organizationId: user.organizationId,
        isPlatform: org.isPlatform,
        isOwner: user.isOwner,
        sessionId: session.id,
        actingOrganizationId: null,
      },
    };
  }
}
