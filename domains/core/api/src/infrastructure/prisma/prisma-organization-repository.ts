import { Location, Organization } from '../../domain/index.js';
import type { OrganizationRepository } from '../../application/ports/index.js';
import { mapConflicts, type Db } from './db.js';

const toDomain = (r: { id: string; slug: string; name: string; isPlatform: boolean; deactivatedAt: Date | null }) =>
  Organization.restore({ id: r.id, slug: r.slug, name: r.name, isPlatform: r.isPlatform, deactivatedAt: r.deactivatedAt });

const toLocation = (r: { id: string; organizationId: string; name: string; timezone: string; deactivatedAt: Date | null }) =>
  Location.restore({ id: r.id, organizationId: r.organizationId, name: r.name, timezone: r.timezone, deactivatedAt: r.deactivatedAt });

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Db) {}

  async findById({ id }: { id: string }) {
    const r = await this.db.organization.findUnique({ where: { id } });
    return r && toDomain(r);
  }

  async findBySlug({ slug }: { slug: string }) {
    const r = await this.db.organization.findUnique({ where: { slug } });
    return r && toDomain(r);
  }

  async listWithLocations() {
    const rows = await this.db.organization.findMany({
      where: { isPlatform: false },
      include: { locations: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({ organization: toDomain(r), locations: r.locations.map(toLocation) }));
  }

  save(o: Organization) {
    const data = { slug: o.slug, name: o.name, isPlatform: o.isPlatform, deactivatedAt: o.deactivatedAt };
    return mapConflicts(
      async () => void (await this.db.organization.upsert({ where: { id: o.id }, create: { id: o.id, ...data }, update: data })),
      'Organization',
    );
  }
}
