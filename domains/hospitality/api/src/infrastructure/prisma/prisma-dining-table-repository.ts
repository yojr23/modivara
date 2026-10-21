import { DuplicateError } from '../../domain/errors.js';
import { DiningTable, type DiningTableProps } from '../../domain/tables/dining-table.js';
import type { ById, DiningTableRepository, Scope } from '../../application/ports/index.js';
import { mapUnique, type Db } from './db.js';

const toDomain = (r: DiningTableProps) => DiningTable.restore(r);

export class PrismaDiningTableRepository implements DiningTableRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId, locationId }: ById) {
    const r = await this.db.diningTable.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  async findActiveByLabel({ zoneId, label, organizationId, locationId }: Scope & { zoneId: string | null; label: string }) {
    // Comparación en memoria (ILIKE trataría % y _ como comodines); el índice único es la garantía real.
    const wanted = label.trim().toLowerCase();
    const rows = await this.db.diningTable.findMany({ where: { organizationId, locationId, zoneId, deactivatedAt: null } });
    const r = rows.find((t) => t.label.toLowerCase() === wanted);
    return r ? toDomain(r) : null;
  }

  /** Orden del tablero: `position` y, a igual posición, el más antiguo primero (DATA-001 §8.2). Incluye inactivas. */
  async listByLocation({ organizationId, locationId }: Scope) {
    const rows = await this.db.diningTable.findMany({ where: { organizationId, locationId }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    return rows.map(toDomain);
  }

  save(table: DiningTable) {
    const p = table.toProps();
    const data = { zoneId: p.zoneId, label: p.label, position: p.position, updatedAt: p.updatedAt, updatedBy: p.updatedBy, deactivatedAt: p.deactivatedAt };
    return mapUnique(
      async () =>
        void (await this.db.diningTable.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data,
        })),
      () => new DuplicateError('table'),
    );
  }
}
