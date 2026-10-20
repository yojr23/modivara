import { type CoreAccessPort, findActiveLocation, type LocationRef } from '@modivara/core-contracts';
import type { Product } from '../../domain/product.js';
import type { StockLocation } from '../../domain/stock-location.js';
import { LocationUnavailableError, NotFoundError } from '../../domain/errors.js';
import type { ProductRepository } from '../ports/product.repository.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';

/** Quién y en qué negocio actúa; ambos vienen del contexto autorizado en el servidor, nunca del cliente. */
export interface ActorContext {
  organizationId: string;
  actorUserId: string;
}

/** Contexto de las operaciones de stock, que son por local (permisos `commerce.stock.*`): también viene del contexto autorizado. */
export interface StockContext extends ActorContext {
  locationId: string;
}

/** Valida el local con Core (DATA-001 §1): existe, está activo y es del negocio. */
export async function requireLocation(core: CoreAccessPort, organizationId: string, locationId: string): Promise<LocationRef> {
  const location = await findActiveLocation(core, organizationId, locationId);
  if (!location) throw new LocationUnavailableError();
  return location;
}

/** A product of another location counts as missing: its existence is not revealed. */
export async function requireProduct(
  repo: ProductRepository,
  query: { id: string; organizationId: string; locationId: string },
): Promise<Product> {
  const product = await repo.findById(query);
  if (!product) throw new NotFoundError('Product');
  return product;
}

/** A stock location of another location counts as missing: its existence is not revealed. */
export async function requireStockLocation(
  repo: StockLocationRepository,
  query: { id: string; organizationId: string; locationId: string },
): Promise<StockLocation> {
  const found = await repo.findById(query);
  if (!found) throw new NotFoundError('Stock location');
  return found;
}
