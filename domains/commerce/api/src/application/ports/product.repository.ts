import type { Product } from '../../domain/product.js';

/** Every lookup is scoped by tenant: an id from another business does not exist. */
export interface ProductRepository {
  save(product: Product): Promise<void>;
  findById(query: { id: string; organizationId: string }): Promise<Product | null>;
  /** Case-insensitive, active rows only (uq_products_name). */
  findActiveByName(query: { organizationId: string; name: string }): Promise<Product | null>;
  findActiveBySku(query: { organizationId: string; sku: string }): Promise<Product | null>;
}
