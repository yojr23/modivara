import { Organization } from '../../domain/index.js';
import type { OrganizationRepository } from '../../application/ports/index.js';
import { mapConflicts, type Db } from './db.js';

const toDomain = (r: { id: string; slug: string; name: string; isPlatform: boolean; deactivatedAt: Date | null }) =>
  Organization.restore({ id: r.id, slug: r.slug, name: r.name, isPlatform: r.isPlatform, deactivatedAt: r.deactivatedAt });

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

  save(o: Organization) {
    const data = { slug: o.slug, name: o.name, isPlatform: o.isPlatform, deactivatedAt: o.deactivatedAt };
    return mapConflicts(
      async () => void (await this.db.organization.upsert({ where: { id: o.id }, create: { id: o.id, ...data }, update: data })),
      'Organization',
    );
  }
}
