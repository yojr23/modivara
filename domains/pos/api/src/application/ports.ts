import type { Sale } from '../domain/sale.js';
import type { SellableItem } from '../domain/sellable-item.js';

/** Toda búsqueda va acotada por negocio y local: un id de otro sitio no existe. */
export interface ScopedId {
  id: string;
  organizationId: string;
  locationId: string;
}

export interface SellableItemRepository {
  save(item: SellableItem): Promise<void>;
  findById(query: ScopedId): Promise<SellableItem | null>;
  /** Sin distinguir mayúsculas, solo activos. */
  findActiveByName(query: { organizationId: string; locationId: string; name: string }): Promise<SellableItem | null>;
  findActiveBySku(query: { organizationId: string; locationId: string; sku: string }): Promise<SellableItem | null>;
}

// ponytail: sin bloqueo ni versión; POS-14/18 agregan SELECT … FOR UPDATE e idempotencia al adaptador de PostgreSQL.
export interface SaleRepository {
  /** Venta + líneas + eventos pendientes (outbox) en una sola transacción. */
  save(sale: Sale): Promise<void>;
  findById(query: ScopedId): Promise<Sale | null>;
}
