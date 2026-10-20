import type { Product } from '../../domain/product.js';

/** Catalog per location. Every lookup is scoped by tenant and location: an id from elsewhere does not exist. */
export interface ProductRepository {
  save(product: Product): Promise<void>;
  findById(query: { id: string; organizationId: string; locationId: string }): Promise<Product | null>;
  /** Case-insensitive, active rows only (uq_products_name). */
  findActiveByName(query: { organizationId: string; locationId: string; name: string }): Promise<Product | null>;
  findActiveBySku(query: { organizationId: string; locationId: string; sku: string }): Promise<Product | null>;
}
