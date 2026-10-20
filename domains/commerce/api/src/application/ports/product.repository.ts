import type { Product } from '../../domain/product.js';

/** Todas las búsquedas van acotadas por negocio: un id de otro negocio no existe. */
export interface ProductRepository {
  save(product: Product): Promise<void>;
  findById(organizationId: string, id: string): Promise<Product | null>;
  /** Comparación sin distinguir mayúsculas, solo entre activos (uq_products_name). */
  findActiveByName(organizationId: string, name: string): Promise<Product | null>;
  findActiveBySku(organizationId: string, sku: string): Promise<Product | null>;
}
