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
  async findById(organizationId: string, id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }
  protected all(organizationId: string): T[] {
    return [...this.rows.values()].filter((r) => r.organizationId === organizationId);
  }
}

export class InMemoryProductRepository extends Store<Product> implements ProductRepository {
  async findActiveByName(organizationId: string, name: string) {
    return this.all(organizationId).find((p) => p.isActive && same(p.name, name)) ?? null;
  }
  async findActiveBySku(organizationId: string, sku: string) {
    return this.all(organizationId).find((p) => p.isActive && p.sku === sku) ?? null;
  }
}

export class InMemoryStockLocationRepository extends Store<StockLocation> implements StockLocationRepository {
  async findActiveDefault(organizationId: string, locationId: string) {
    return this.all(organizationId).find((s) => s.isActive && s.isDefault && s.locationId === locationId) ?? null;
  }
  async findActiveByName(organizationId: string, locationId: string, name: string) {
    return this.all(organizationId).find((s) => s.isActive && s.locationId === locationId && same(s.name, name)) ?? null;
  }
}

export class InMemoryMovementReasonRepository extends Store<MovementReason> implements MovementReasonRepository {
  async findActiveByName(organizationId: string, name: string) {
    return this.all(organizationId).find((r) => r.isActive && same(r.name, name)) ?? null;
  }
}
