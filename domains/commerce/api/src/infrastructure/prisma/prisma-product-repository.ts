import { ConflictError } from '../../domain/errors.js';
import { Product } from '../../domain/product.js';
import type { ProductRepository } from '../../application/ports/product.repository.js';
import { mapUnique, type Db } from './db.js';
import type { Product as ProductRow } from './generated/client.js';

// created_by/updated_by son nullable en la base (DATA-001 AUDIT) pero la aplicación siempre los escribe.
const toDomain = (r: ProductRow) =>
  Product.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, name: r.name, sku: r.sku, category: r.category, unit: r.unit,
    deactivatedAt: r.deactivatedAt, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy!, updatedBy: r.updatedBy!,
  });

type Scope = { organizationId: string; locationId: string };

export class PrismaProductRepository implements ProductRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId, locationId }: Scope & { id: string }) {
    const r = await this.db.product.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  /** `lower()` de la base, el mismo que usa el índice único (no ILIKE: trataría % y _ como comodines). */
  async findActiveByName({ organizationId, locationId, name }: Scope & { name: string }) {
    const [row] = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM products
      WHERE organization_id = ${organizationId}::uuid AND location_id = ${locationId}::uuid AND deactivated_at IS NULL AND lower(name) = lower(${name})`;
    return row ? this.findById({ id: row.id, organizationId, locationId }) : null;
  }

  async findActiveBySku({ organizationId, locationId, sku }: Scope & { sku: string }) {
    const r = await this.db.product.findFirst({ where: { organizationId, locationId, sku, deactivatedAt: null } });
    return r && toDomain(r);
  }

  async list({ organizationId, locationId }: Scope) {
    const rows = await this.db.product.findMany({ where: { organizationId, locationId }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(toDomain);
  }

  save(product: Product) {
    const p = product.toProps();
    const data = { name: p.name, sku: p.sku, category: p.category, deactivatedAt: p.deactivatedAt, updatedAt: p.updatedAt, updatedBy: p.updatedBy };
    return mapUnique(
      async () =>
        void (await this.db.product.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, unit: p.unit, createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data,
        })),
      () => new ConflictError(`An active product named "${p.name}" or with that SKU already exists`),
    );
  }
}
