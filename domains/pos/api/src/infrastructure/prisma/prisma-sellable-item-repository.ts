import { MONEY_SCALE, formatScaled, parseScaled } from '@modivara/pos-contracts';
import type { LocationScope, ScopedId, SellableItemRepository } from '../../application/ports.js';
import { ConflictError } from '../../domain/errors.js';
import { SellableItem } from '../../domain/sellable-item.js';
import type { PosPrisma } from './client.js';
import { assertCurrentCurrency, isUniqueViolation, lockCurrency, type Db } from './db.js';
import type { SellableItem as Row } from './generated/client.js';

const toDomain = (r: Row) =>
  SellableItem.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, name: r.name, sku: r.sku, category: r.category, unit: r.unit,
    price: parseScaled(r.price.toFixed(MONEY_SCALE), MONEY_SCALE), currency: r.currency, deactivatedAt: r.deactivatedAt,
    createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, updatedBy: r.updatedBy,
  });

export class PrismaSellableItemRepository implements SellableItemRepository {
  constructor(private readonly db: PosPrisma) {}

  async findById({ id, organizationId, locationId }: ScopedId) {
    const r = await this.db.sellableItem.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  async list({ organizationId, locationId }: LocationScope) {
    const rows = await this.db.sellableItem.findMany({ where: { organizationId, locationId }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(toDomain);
  }

  /** `lower()` de la base, el mismo que usa el índice único (no ILIKE: trataría % y _ como comodines). */
  async findActiveByName({ organizationId, locationId, name }: LocationScope & { name: string }) {
    const [row] = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM sellable_items
      WHERE organization_id = ${organizationId}::uuid AND location_id = ${locationId}::uuid AND deactivated_at IS NULL AND lower(name) = lower(${name})`;
    return row ? this.findById({ id: row.id, organizationId, locationId }) : null;
  }

  async findActiveBySku({ organizationId, locationId, sku }: LocationScope & { sku: string }) {
    const r = await this.db.sellableItem.findFirst({ where: { organizationId, locationId, sku, deactivatedAt: null } });
    return r && toDomain(r);
  }

  /** Los índices únicos parciales deciden: dos altas simultáneas con el mismo nombre dan una `ConflictError`. */
  save(item: SellableItem) {
    return this.write(this.db, item);
  }

  add(item: SellableItem) {
    const { organizationId, locationId, currency } = item.toProps();
    return this.db.$transaction(async (tx) => {
      await lockCurrency(tx, locationId, 'shared');
      await assertCurrentCurrency(tx, { organizationId, locationId }, currency);
      await this.write(tx, item);
    }, { timeout: 15_000, maxWait: 15_000 });
  }

  private async write(db: Db, item: SellableItem) {
    const p = item.toProps();
    const data = {
      name: p.name, sku: p.sku, category: p.category, price: formatScaled(p.price, MONEY_SCALE), deactivatedAt: p.deactivatedAt,
      updatedAt: p.updatedAt, updatedBy: p.updatedBy,
    };
    try {
      await db.sellableItem.upsert({
        where: { id: p.id },
        create: {
          id: p.id, organizationId: p.organizationId, locationId: p.locationId, unit: p.unit, currency: p.currency,
          createdAt: p.createdAt, createdBy: p.createdBy, ...data,
        },
        update: data,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(`An active item named "${p.name}" or with that SKU already exists`);
      throw e;
    }
  }
}
