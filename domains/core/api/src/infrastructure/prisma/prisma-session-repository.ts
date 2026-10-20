import { Session } from '../../domain/index.js';
import type { SessionRepository } from '../../application/ports/index.js';
import { mapConflicts, type Db } from './db.js';

// En dominio el hash es hex; en la base, bytea. El token en claro nunca llega aquí.
const toBytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));

type Row = Omit<Parameters<typeof Session.restore>[0], 'tokenHash'> & { tokenHash: Uint8Array };
const toDomain = (r: Row) =>
  Session.restore({
    id: r.id, userId: r.userId, tokenHash: Buffer.from(r.tokenHash).toString('hex'),
    actingOrganizationId: r.actingOrganizationId, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt,
    expiresAt: r.expiresAt, revokedAt: r.revokedAt, ip: r.ip, userAgent: r.userAgent,
  });

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, userId }: { id: string; userId: string }) {
    const r = await this.db.session.findFirst({ where: { id, userId } });
    return r && toDomain(r);
  }

  async findByTokenHash({ tokenHash }: { tokenHash: string }) {
    const r = await this.db.session.findUnique({ where: { tokenHash: toBytes(tokenHash) } });
    return r && toDomain(r);
  }

  save(s: Session) {
    const data = { actingOrganizationId: s.actingOrganizationId, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt };
    return mapConflicts(
      async () =>
        void (await this.db.session.upsert({
          where: { id: s.id },
          create: { id: s.id, userId: s.userId, tokenHash: toBytes(s.tokenHash), createdAt: s.createdAt, ip: s.ip, userAgent: s.userAgent, ...data },
          update: data,
        })),
      'Session',
    );
  }

  async revokeAllForUser({ organizationId, userId }: { organizationId: string; userId: string }, now: Date) {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null, user: { organizationId } },
      data: { revokedAt: now },
    });
  }
}
