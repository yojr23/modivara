import type { MovementDirection } from '@modivara/commerce-contracts';
import type { DateRange } from '../../domain/index.js';
import type { StockMovementFactQuery, StockMovementFactRepository } from '../../application/index.js';
import { StockMovementFact } from '../../domain/index.js';
import type { Db } from './db.js';
import { Prisma, type StockMovementFact as Row } from './generated/client.js';

const toDomain = (r: Row) =>
  StockMovementFact.restore({ ...r, direction: r.direction as MovementDirection, delta: r.delta.toFixed(3), balanceAfter: r.balanceAfter.toFixed(3) });

export class PrismaStockMovementFactRepository implements StockMovementFactRepository {
  constructor(private readonly db: Db) {}

  async save(fact: StockMovementFact): Promise<void> {
    const data = { ...fact.snapshot };
    await this.db.stockMovementFact.upsert({ where: { movementId: data.movementId }, create: data, update: data });
  }

  private where(q: StockMovementFactQuery): Prisma.StockMovementFactWhereInput {
    return {
      organizationId: q.organizationId,
      locationId: q.locationId,
      ...(q.productId && { productId: q.productId }),
      ...(q.stockLocationId && { stockLocationId: q.stockLocationId }),
    };
  }

  async findOccurredBetween(q: StockMovementFactQuery & { range: DateRange }): Promise<StockMovementFact[]> {
    const rows = await this.db.stockMovementFact.findMany({
      where: { ...this.where(q), occurredAt: { gte: q.range.from, lt: q.range.to } },
    });
    return rows.map(toDomain);
  }

  async findLatestPerPlaceAndProduct(q: StockMovementFactQuery): Promise<StockMovementFact[]> {
    // Desempate por movement_id mayor, igual que el doble en memoria (OPEN en domain/inventory-metrics.ts).
    const ids = await this.db.$queryRaw<{ movement_id: string }[]>(Prisma.sql`
      SELECT DISTINCT ON (stock_location_id, product_id) movement_id
      FROM stock_movement_facts
      WHERE organization_id = ${q.organizationId}::uuid AND location_id = ${q.locationId}::uuid
        ${q.productId ? Prisma.sql`AND product_id = ${q.productId}::uuid` : Prisma.empty}
        ${q.stockLocationId ? Prisma.sql`AND stock_location_id = ${q.stockLocationId}::uuid` : Prisma.empty}
      ORDER BY stock_location_id, product_id, occurred_at DESC, movement_id DESC`);
    const rows = await this.db.stockMovementFact.findMany({ where: { movementId: { in: ids.map((r) => r.movement_id) } } });
    return rows.map(toDomain);
  }

  async clear(): Promise<void> {
    await this.db.stockMovementFact.deleteMany();
  }
}
