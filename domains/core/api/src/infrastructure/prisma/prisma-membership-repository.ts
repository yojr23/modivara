import { LocationMembership } from '../../domain/index.js';
import type { MembershipRepository } from '../../application/ports/index.js';
import { mapConflicts, type Db } from './db.js';

const toDomain = (r: Parameters<typeof LocationMembership.restore>[0]) =>
  LocationMembership.restore({
    id: r.id, organizationId: r.organizationId, userId: r.userId, locationId: r.locationId, roles: r.roles, deactivatedAt: r.deactivatedAt,
  });

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: Db) {}

  async findActive({ organizationId, userId, locationId }: { organizationId: string; userId: string; locationId: string }) {
    const r = await this.db.locationMembership.findFirst({ where: { organizationId, userId, locationId, deactivatedAt: null } });
    return r && toDomain(r);
  }

  async listActiveByUser({ organizationId, userId }: { organizationId: string; userId: string }) {
    const rows = await this.db.locationMembership.findMany({ where: { organizationId, userId, deactivatedAt: null }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }

  save(m: LocationMembership) {
    const data = { roles: [...m.roles], deactivatedAt: m.deactivatedAt };
    return mapConflicts(
      async () =>
        void (await this.db.locationMembership.upsert({
          where: { id: m.id },
          create: { id: m.id, organizationId: m.organizationId, userId: m.userId, locationId: m.locationId, ...data },
          update: data,
        })),
      'Membership',
    );
  }
}
