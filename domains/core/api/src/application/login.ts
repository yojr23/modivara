import { isValidUsername, newId } from '@modivara/core-contracts';
import { InvalidCredentialsError, Session } from '../domain/index.js';
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

  private dummy?: Promise<string>;
  /** Hash ficticio (de una contraseña aleatoria) contra el que se verifica cuando la cuenta está bloqueada. */
  private dummyHash(): Promise<string> {
    return (this.dummy ??= this.hasher.hash(newId()));
  }

  async execute(input: LoginInput): Promise<LoginOutput> {
    const username = input.username.trim().toLowerCase();
    const org = await this.organizations.findBySlug({ slug: input.slug.trim().toLowerCase() });
    const user = org?.isActive && isValidUsername(username) ? await this.users.findActiveByUsername({ organizationId: org.id, username }) : null;

    if (!org || !user) {
      // Trabajo equivalente al camino real para no delatar por tiempo si el usuario existe.
      await this.hasher.hash(input.password);
      throw new InvalidCredentialsError();
    }

    const outcome = await this.users.withLoginLock({ id: user.id, organizationId: user.organizationId }, async (tx) => {
      const locked = tx.user;
      if (!locked) {
        await this.hasher.hash(input.password);
        return { kind: 'invalid' } as const;
      }
      const now = new Date();
      // OPEN: hoy el bloqueo responde genérico (401 invalid_credentials, igual que usuario inexistente) para no revelar que la
      // cuenta existe; el aviso de bloqueo al usuario legítimo por otro canal está pendiente. Riesgo conocido: quien conozca un
      // usuario (p. ej. `labs/superadmin`) puede mantenerlo bloqueado repitiendo 5 fallos; la política «por usuario y negocio»
      // viene de TECH-001 §16.3.
      if (locked.lockedUntil(now)) {
        // Mismo costo que un intento real, para que el tiempo de respuesta no delate el bloqueo.
        await this.hasher.verify(await this.dummyHash(), input.password);
        return { kind: 'invalid' } as const;
      }
      if (!(await this.hasher.verify(locked.passwordHash, input.password))) {
        locked.registerFailedLogin(now);
        await tx.save(locked);
        return { kind: 'invalid' } as const;
      }
      if (locked.registerSuccessfulLogin()) await tx.save(locked);
      return { kind: 'ok', user: locked } as const;
    });
    if (outcome.kind === 'invalid') throw new InvalidCredentialsError();

    const now = new Date();
    const { token, tokenHash } = this.tokens.generate();
    const session = Session.create({ id: newId(), userId: user.id, tokenHash, now, ip: input.ip, userAgent: input.userAgent });
    await this.sessions.create(session);

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
