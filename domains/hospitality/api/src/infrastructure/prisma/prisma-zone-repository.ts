import { DuplicateError } from '../../domain/errors.js';
import { Zone, type ZoneProps } from '../../domain/tables/zone.js';
import type { ById, Scope, ZoneRepository } from '../../application/ports/index.js';
import { mapUnique, type Db } from './db.js';

const toDomain = (r: ZoneProps) =>
  Zone.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, name: r.name, position: r.position,
    createdAt: r.createdAt, createdBy: r.createdBy, deactivatedAt: r.deactivatedAt,
  });

export class PrismaZoneRepository implements ZoneRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId, locationId }: ById) {
    const r = await this.db.zone.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  async findActiveByName({ name, organizationId, locationId }: Scope & { name: string }) {
    // Comparación en memoria (no `mode: 'insensitive'`, que usa ILIKE y trata % y _ como comodines); el índice único es la garantía real.
    const wanted = name.trim().toLowerCase();
    const rows = await this.db.zone.findMany({ where: { organizationId, locationId, deactivatedAt: null } });
    const r = rows.find((z) => z.name.toLowerCase() === wanted);
    return r ? toDomain(r) : null;
  }

  /** Orden del tablero: `position` y, a igual posición, el más antiguo primero (UUIDv7 ordena por tiempo). DATA-001 §8.2. */
  async listByLocation({ organizationId, locationId }: Scope) {
    const rows = await this.db.zone.findMany({ where: { organizationId, locationId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    return rows.map(toDomain);
  }

  save(zone: Zone) {
    const p = zone.toProps();
    const data = { name: p.name, position: p.position, deactivatedAt: p.deactivatedAt };
    return mapUnique(
      async () =>
        void (await this.db.zone.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data,
        })),
      () => new DuplicateError('zone'),
    );
  }
}
