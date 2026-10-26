import { ConflictError } from '../../domain/errors.js';
import { StockLocation } from '../../domain/stock-location.js';
import type { StockLocationRepository } from '../../application/ports/stock-location.repository.js';
import { mapUnique, type Db } from './db.js';
import type { StockLocation as StockLocationRow } from './generated/client.js';

const toDomain = (r: StockLocationRow) =>
  StockLocation.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, name: r.name, isDefault: r.isDefault,
    deactivatedAt: r.deactivatedAt, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy!, updatedBy: r.updatedBy!,
  });

type Scope = { organizationId: string; locationId: string };

export class PrismaStockLocationRepository implements StockLocationRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId, locationId }: Scope & { id: string }) {
    const r = await this.db.stockLocation.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  async findActiveDefault({ organizationId, locationId }: Scope) {
    const r = await this.db.stockLocation.findFirst({ where: { organizationId, locationId, isDefault: true, deactivatedAt: null } });
    return r && toDomain(r);
  }

  async findActiveByName({ organizationId, locationId, name }: Scope & { name: string }) {
    const [row] = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_locations
      WHERE organization_id = ${organizationId}::uuid AND location_id = ${locationId}::uuid AND deactivated_at IS NULL AND lower(name) = lower(${name})`;
    return row ? this.findById({ id: row.id, organizationId, locationId }) : null;
  }

  async list({ organizationId, locationId }: Scope) {
    const rows = await this.db.stockLocation.findMany({
      where: { organizationId, locationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  save(stockLocation: StockLocation) {
    const p = stockLocation.toProps();
    const data = { name: p.name, isDefault: p.isDefault, deactivatedAt: p.deactivatedAt, updatedAt: p.updatedAt, updatedBy: p.updatedBy };
    return mapUnique(
      async () =>
        void (await this.db.stockLocation.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data,
        })),
      () => new ConflictError(`An active stock location named "${p.name}" or a default one already exists in the location`),
    );
  }
}
