import type { MovementReasonRepository } from '../application/ports/movement-reason.repository.js';
import type { ProductRepository } from '../application/ports/product.repository.js';
import type { StockLocationRepository } from '../application/ports/stock-location.repository.js';
import type { MovementReason } from '../domain/movement-reason.js';
import type { Product } from '../domain/product.js';
import type { StockLocation } from '../domain/stock-location.js';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

abstract class Store<T extends { id: string; organizationId: string }> {
  protected readonly rows = new Map<string, T>();
  async save(row: T): Promise<void> {
    this.rows.set(row.id, row);
  }
  protected async byId(organizationId: string, id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
  protected all(organizationId: string): T[] {
    return [...this.rows.values()].filter((r) => r.organizationId === organizationId);
  }
}

export class InMemoryProductRepository extends Store<Product> implements ProductRepository {
  async findById({ id, organizationId, locationId }: { id: string; organizationId: string; locationId: string }) {
    const row = await this.byId(organizationId, id);
    return row && row.locationId === locationId ? row : null;
  }
  async findActiveByName({ organizationId, locationId, name }: { organizationId: string; locationId: string; name: string }) {
    return this.all(organizationId).find((p) => p.isActive && p.locationId === locationId && same(p.name, name)) ?? null;
  }
  async findActiveBySku({ organizationId, locationId, sku }: { organizationId: string; locationId: string; sku: string }) {
    return this.all(organizationId).find((p) => p.isActive && p.locationId === locationId && p.sku === sku) ?? null;
  }
  async list({ organizationId, locationId }: { organizationId: string; locationId: string }) {
    return this.all(organizationId).filter((p) => p.locationId === locationId).sort((a, b) => a.name.localeCompare(b.name));
  }
}

export class InMemoryStockLocationRepository extends Store<StockLocation> implements StockLocationRepository {
  async findById({ id, organizationId, locationId }: { id: string; organizationId: string; locationId: string }) {
    const row = await this.byId(organizationId, id);
    return row && row.locationId === locationId ? row : null;
  }
  async findActiveDefault({ organizationId, locationId }: { organizationId: string; locationId: string }) {
    return this.all(organizationId).find((s) => s.isActive && s.isDefault && s.locationId === locationId) ?? null;
  }
  async findActiveByName({ organizationId, locationId, name }: { organizationId: string; locationId: string; name: string }) {
    return this.all(organizationId).find((s) => s.isActive && s.locationId === locationId && same(s.name, name)) ?? null;
  }
  async list({ organizationId, locationId }: { organizationId: string; locationId: string }) {
    return this.all(organizationId)
      .filter((s) => s.locationId === locationId)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  }
}

export class InMemoryMovementReasonRepository extends Store<MovementReason> implements MovementReasonRepository {
  findById({ id, organizationId }: { id: string; organizationId: string }) {
    return this.byId(organizationId, id);
  }
  async findActiveByName({ organizationId, name }: { organizationId: string; name: string }) {
    return this.all(organizationId).find((r) => r.isActive && same(r.name, name)) ?? null;
  }
  async list({ organizationId }: { organizationId: string }) {
    return this.all(organizationId).sort((a, b) => a.direction.localeCompare(b.direction) || a.name.localeCompare(b.name));
  }
}
