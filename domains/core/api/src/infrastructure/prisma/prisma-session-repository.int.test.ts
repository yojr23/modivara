import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { Session, SESSION_TOUCH_INTERVAL_MS } from '../../domain/index.js';
import { CryptoSessionTokenService } from '../crypto-session-token.service.js';
import { PrismaSessionRepository } from './prisma-session-repository.js';

const db = corePrismaForTests();
const repo = new PrismaSessionRepository(db);
const tokens = new CryptoSessionTokenService();
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

async function world() {
  const sol = await seedOrganization(db, 'bar-sol');
  const luna = await seedOrganization(db, 'bar-luna');
  const user = await seedUser(db, sol);
  const { token, tokenHash } = tokens.generate();
  const now = new Date();
  const session = Session.create({ id: newId(), userId: user.id, tokenHash, now, ip: '10.0.0.7', userAgent: 'vitest' });
  await repo.create(session);
  return { sol, luna, user, token, tokenHash, now, session };
}

describe('PrismaSessionRepository', () => {
  it('crea y resuelve por token_hash; el token en claro nunca se persiste', async () => {
    const { user, token, tokenHash, session } = await world();
    const found = await repo.findByTokenHash({ tokenHash });
    expect(found).toMatchObject({ id: session.id, userId: user.id, tokenHash, ip: '10.0.0.7', userAgent: 'vitest' });
    expect(await repo.findByTokenHash({ tokenHash: tokens.hash('otro') })).toBeNull();

    // En la base es bytea con el SHA-256, y ninguna columna contiene el token.
    const [row] = await db.$queryRaw<{ len: number; dump: string }[]>`SELECT octet_length(token_hash) AS len, s::text AS dump FROM sessions s`;
    expect(row?.len).toBe(32);
    expect(row?.dump).not.toContain(token);
  });

  it('findById acotado por usuario', async () => {
    const { session, user } = await world();
    expect((await repo.findById({ id: session.id, userId: user.id }))?.id).toBe(session.id);
    expect(await repo.findById({ id: session.id, userId: newId() })).toBeNull();
  });

  it('desliza expires_at como máximo una vez por hora', async () => {
    const { tokenHash, now } = await world();
    const s = (await repo.findByTokenHash({ tokenHash }))!;
    expect(s.touch(new Date(now.getTime() + SESSION_TOUCH_INTERVAL_MS - 1))).toBe(false);
    const later = new Date(now.getTime() + SESSION_TOUCH_INTERVAL_MS);
    expect(s.touch(later)).toBe(true);
    await repo.touch(s);
    const r = (await repo.findByTokenHash({ tokenHash }))!;
    expect(r.lastSeenAt.getTime()).toBe(later.getTime());
    expect(r.expiresAt.getTime()).toBe(s.expiresAt.getTime());
    expect(r.touch(new Date(later.getTime() + 1000))).toBe(false);
  });

  it('revoca una sesión y todas las del usuario, sin tocar otro negocio', async () => {
    const { sol, luna, user, session, tokenHash } = await world();
    const other = await seedUser(db, luna, 'beto');
    const otherSession = Session.create({ id: newId(), userId: other.id, tokenHash: tokens.generate().tokenHash, now: new Date() });
    await repo.create(otherSession);

    const second = Session.create({ id: newId(), userId: user.id, tokenHash: tokens.generate().tokenHash, now: new Date() });
    await repo.create(second);
    session.revoke(new Date());
    await repo.revoke(session);
    expect((await repo.findByTokenHash({ tokenHash }))?.revokedAt).not.toBeNull();

    // El negocio equivocado no revoca nada.
    await repo.revokeAllForUser({ organizationId: luna.id, userId: user.id }, new Date());
    expect((await repo.findById({ id: second.id, userId: user.id }))?.revokedAt).toBeNull();

    await repo.revokeAllForUser({ organizationId: sol.id, userId: user.id }, new Date());
    expect((await repo.findById({ id: second.id, userId: user.id }))?.revokedAt).not.toBeNull();
    expect((await repo.findById({ id: otherSession.id, userId: other.id }))?.revokedAt).toBeNull();
  });

  it('actingOrganizationId persiste', async () => {
    const { luna, session, user } = await world();
    session.actAs(luna.id, { isPlatform: true });
    await repo.setActingOrganization(session);
    expect((await repo.findById({ id: session.id, userId: user.id }))?.actingOrganizationId).toBe(luna.id);
  });

  it('un touch con la entidad leída antes no deshace una revocación ni el negocio elegido', async () => {
    const { luna, user, session, tokenHash } = await world();
    const stale = (await repo.findByTokenHash({ tokenHash }))!; // leída antes de la revocación
    session.revoke(new Date());
    await repo.revoke(session);
    expect(stale.touch(new Date(Date.now() + SESSION_TOUCH_INTERVAL_MS))).toBe(true);
    await repo.touch(stale);
    expect((await repo.findById({ id: session.id, userId: user.id }))?.revokedAt).not.toBeNull();

    // Idem con el negocio elegido: un touch rezagado no lo pisa.
    const other = Session.create({ id: newId(), userId: user.id, tokenHash: tokens.generate().tokenHash, now: new Date() });
    await repo.create(other);
    const stale2 = (await repo.findById({ id: other.id, userId: user.id }))!;
    other.actAs(luna.id, { isPlatform: true });
    await repo.setActingOrganization(other);
    stale2.touch(new Date(Date.now() + SESSION_TOUCH_INTERVAL_MS));
    await repo.touch(stale2);
    expect((await repo.findById({ id: other.id, userId: user.id }))?.actingOrganizationId).toBe(luna.id);
  });
});
