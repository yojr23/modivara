import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@modivara/core-contracts';
import {
  AuthenticateSession, ChangePassword, CreateUser, DeactivateUser, Login, type ActorContext,
} from '../../application/index.js';
import { AccountLockedError, InvalidCredentialsError, SessionInvalidError } from '../../domain/index.js';
import { corePrismaForTests, resetCore, seedOrganization } from '../../testing/integration.js';
import { Argon2PasswordHasher } from '../argon2-password-hasher.js';
import { CryptoSessionTokenService } from '../crypto-session-token.service.js';
import {
  PrismaAuditLog, PrismaMembershipRepository, PrismaOrganizationRepository, PrismaSessionRepository, PrismaUserRepository,
} from './index.js';

// Casos de uso con adaptadores Prisma reales y Argon2 real (F1-05). Los temporizadores falsos solo tocan Date.
const db = corePrismaForTests();
const organizations = new PrismaOrganizationRepository(db);
const users = new PrismaUserRepository(db);
const memberships = new PrismaMembershipRepository(db);
const sessions = new PrismaSessionRepository(db);
const audit = new PrismaAuditLog(db);
const hasher = new Argon2PasswordHasher();
const tokens = new CryptoSessionTokenService();

const login = new Login(organizations, users, sessions, hasher, tokens);
const authenticate = new AuthenticateSession(sessions, users, organizations, tokens);
const createUser = new CreateUser(organizations, users, memberships, hasher, audit);
const deactivateUser = new DeactivateUser(users, memberships, sessions, audit);
const changePassword = new ChangePassword(users, sessions, hasher);

const PASSWORD = 'Secret123';
const MIN = 60_000;
const attempt = (password: string, username = 'ana') => login.execute({ slug: 'bar-sol', username, password });
const activeSessions = (username: string) =>
  db.session.count({ where: { revokedAt: null, user: { username } } });

let owner: ActorContext;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  await resetCore(db);
  const sol = await seedOrganization(db, 'bar-sol');
  owner = { actorUserId: newId(), organizationId: sol.id, isPlatform: false, isOwner: true, sessionId: newId(), actingOrganizationId: null };
  await createUser.execute({ actor: owner, username: 'ana', displayName: 'Ana', password: PASSWORD });
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

describe('casos de uso de core sobre PostgreSQL', () => {
  it('crear usuario guarda hash Argon2 y escribe la auditoría', async () => {
    const row = await db.appUser.findFirstOrThrow({ where: { username: 'ana' } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    const entries = await db.auditLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'user.created', targetId: row.id, actorUserId: owner.actorUserId });
    expect(JSON.stringify(entries[0]?.details)).not.toContain(PASSWORD);
  });

  it('login válido crea sesión; AuthenticateSession la resuelve y logout-style revocación la invalida', async () => {
    const out = await attempt(PASSWORD);
    expect(await authenticate.execute({ token: out.token })).toMatchObject({ actorUserId: out.actor.actorUserId });
    await sessions.revokeAllForUser({ organizationId: owner.organizationId, userId: out.actor.actorUserId }, new Date());
    await expect(authenticate.execute({ token: out.token })).rejects.toBeInstanceOf(SessionInvalidError);
  });

  it('5 fallos bloquean; el 6.º con la contraseña correcta se rechaza hasta que pasa la ventana', async () => {
    for (let i = 0; i < 5; i++) await expect(attempt('Wrong1234')).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect((await db.appUser.findFirstOrThrow({ where: { username: 'ana' } })).failedLoginCount).toBe(5);

    await expect(attempt(PASSWORD)).rejects.toBeInstanceOf(AccountLockedError);
    vi.setSystemTime(new Date('2026-10-19T10:14:00Z'));
    await expect(attempt(PASSWORD)).rejects.toBeInstanceOf(AccountLockedError);

    vi.setSystemTime(new Date('2026-10-19T10:00:00Z').getTime() + 15 * MIN);
    await expect(attempt(PASSWORD)).resolves.toBeDefined();
    expect((await db.appUser.findFirstOrThrow({ where: { username: 'ana' } })).failedLoginCount).toBe(0);
  });

  it('cambiar contraseña deja 0 sesiones activas y la anterior ya no sirve', async () => {
    const a = await attempt(PASSWORD);
    await attempt(PASSWORD);
    expect(await activeSessions('ana')).toBe(2);
    await changePassword.execute({ actor: a.actor, currentPassword: PASSWORD, newPassword: 'Another456' });
    expect(await activeSessions('ana')).toBe(0);
    await expect(authenticate.execute({ token: a.token })).rejects.toBeInstanceOf(SessionInvalidError);
    await expect(attempt(PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(attempt('Another456')).resolves.toBeDefined();
  });

  it('desactivar usuario deja 0 sesiones activas, libera el login y audita', async () => {
    const a = await attempt(PASSWORD);
    await attempt(PASSWORD);
    await deactivateUser.execute({ actor: owner, userId: a.actor.actorUserId });
    expect(await activeSessions('ana')).toBe(0);
    await expect(attempt(PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError);
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'user.deactivated' } });
    expect(entry).toMatchObject({ targetId: a.actor.actorUserId, organizationId: owner.organizationId });
    // El username queda libre para un alta nueva.
    await expect(createUser.execute({ actor: owner, username: 'ana', displayName: 'Ana 2', password: PASSWORD })).resolves.toBeDefined();
  });
});
