import { Location } from '../../domain/index.js';
import type { LocationRepository } from '../../application/ports/index.js';
import { mapConflicts, type Db } from './db.js';

const toDomain = (r: { id: string; organizationId: string; name: string; timezone: string; deactivatedAt: Date | null }) =>
  Location.restore({ id: r.id, organizationId: r.organizationId, name: r.name, timezone: r.timezone, deactivatedAt: r.deactivatedAt });

export class PrismaLocationRepository implements LocationRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId }: { id: string; organizationId: string }) {
    const r = await this.db.location.findFirst({ where: { id, organizationId } });
    return r && toDomain(r);
  }

  /** Una sola consulta: el JOIN con el negocio lo hace Prisma. */
  async findByIdWithOrganization({ id, organizationId }: { id: string; organizationId?: string }) {
    const r = await this.db.location.findFirst({
      where: { id, ...(organizationId !== undefined && { organizationId }) },
      include: { organization: { select: { deactivatedAt: true } } },
    });
    return r && { location: toDomain(r), organizationActive: r.organization.deactivatedAt === null };
  }

  async listActive({ organizationId }: { organizationId: string }) {
    const rows = await this.db.location.findMany({ where: { organizationId, deactivatedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(toDomain);
  }

  save(l: Location) {
    const data = { name: l.name, timezone: l.timezone, deactivatedAt: l.deactivatedAt };
    return mapConflicts(
      async () =>
        void (await this.db.location.upsert({
          where: { id: l.id },
          create: { id: l.id, organizationId: l.organizationId, ...data },
          update: data,
        })),
      'Location',
    );
  }
}
