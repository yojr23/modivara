import { AppUser } from '../../domain/index.js';
import type { UserRepository } from '../../application/ports/index.js';
import { mapConflicts, type Db } from './db.js';

type Row = Parameters<typeof AppUser.restore>[0];
const toDomain = (r: Row) =>
  AppUser.restore({
    id: r.id, organizationId: r.organizationId, username: r.username, displayName: r.displayName,
    passwordHash: r.passwordHash, isOwner: r.isOwner, passwordChangedAt: r.passwordChangedAt,
    failedLoginCount: r.failedLoginCount, failedLoginWindowStart: r.failedLoginWindowStart, deactivatedAt: r.deactivatedAt,
  });

function saveUser(db: Db, u: AppUser) {
  const data = {
    username: u.username, displayName: u.displayName, passwordHash: u.passwordHash, isOwner: u.isOwner,
    passwordChangedAt: u.passwordChangedAt, failedLoginCount: u.failedLoginCount,
    failedLoginWindowStart: u.failedLoginWindowStart, deactivatedAt: u.deactivatedAt,
  };
  return mapConflicts(
    async () => void (await db.appUser.upsert({ where: { id: u.id }, create: { id: u.id, organizationId: u.organizationId, ...data }, update: data })),
    'User',
  );
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: Db) {}

  async findById({ id, organizationId }: { id: string; organizationId: string }) {
    const r = await this.prisma.appUser.findFirst({ where: { id, organizationId } });
    return r && toDomain(r);
  }

  async findByIdForSession({ id }: { id: string }) {
    const r = await this.prisma.appUser.findUnique({ where: { id } });
    return r && toDomain(r);
  }

  async findActiveByUsername({ organizationId, username }: { organizationId: string; username: string }) {
    const r = await this.prisma.appUser.findFirst({ where: { organizationId, username, deactivatedAt: null } });
    return r && toDomain(r);
  }

  async listActive({ organizationId }: { organizationId: string }) {
    const rows = await this.prisma.appUser.findMany({ where: { organizationId, deactivatedAt: null }, orderBy: { username: 'asc' } });
    return rows.map(toDomain);
  }

  async listAll({ organizationId }: { organizationId: string }) {
    const rows = await this.prisma.appUser.findMany({ where: { organizationId }, orderBy: [{ username: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toDomain);
  }

  async displayNames({ organizationId, userIds }: { organizationId: string; userIds: readonly string[] }) {
    if (!userIds.length) return new Map<string, string>();
    // OPEN: ¿el superadmin (organización plataforma) puede verse con nombre en el historial de cualquier negocio? Hoy sí.
    const rows = await this.prisma.appUser.findMany({
      where: { id: { in: [...userIds] }, OR: [{ organizationId }, { organization: { isPlatform: true } }] },
      select: { id: true, displayName: true },
    });
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  save(u: AppUser) {
    return saveUser(this.prisma, u);
  }

  withLoginLock<T>(
    { id, organizationId }: { id: string; organizationId: string },
    work: (tx: { user: AppUser | null; save(user: AppUser): Promise<void> }) => Promise<T>,
  ): Promise<T> {
    // Dentro de una transacción ya abierta no hay `$transaction`: el bloqueo solo lo usa el login, con el cliente raíz.
    if (!('$transaction' in this.prisma)) throw new Error('withLoginLock requires the root Prisma client');
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM app_users
          WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid AND deactivated_at IS NULL
          FOR UPDATE`;
        // Releer tras el bloqueo (READ COMMITTED): ve lo que confirmó la transacción anterior.
        const row = locked.length ? await tx.appUser.findUnique({ where: { id } }) : null;
        return work({ user: row && toDomain(row), save: (u) => saveUser(tx, u) });
      },
      { timeout: 15_000 },
    );
  }
}
