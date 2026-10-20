import type { CoreAccessPort, LocationRef } from '@modivara/core-contracts';
import type { Product } from '../../domain/product.js';
import type { StockLocation } from '../../domain/stock-location.js';
import { LocationUnavailableError, NotFoundError } from '../errors.js';
import type { ProductRepository } from '../ports/product.repository.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';

/** Quién y en qué negocio actúa; ambos vienen del contexto autorizado en el servidor, nunca del cliente. */
export interface ActorContext {
  organizationId: string;
  actorUserId: string;
}

/** Valida el local con Core (DATA-001 §1): existe, está activo y es del negocio. */
export async function requireLocation(core: CoreAccessPort, organizationId: string, locationId: string): Promise<LocationRef> {
  const location = await core.getLocation(locationId);
  if (!location || !location.active || location.organizationId !== organizationId) {
    throw new LocationUnavailableError('El local no existe, está inactivo o no pertenece al negocio');
  }
  return location;
}

export async function requireProduct(repo: ProductRepository, organizationId: string, id: string): Promise<Product> {
  const product = await repo.findById(organizationId, id);
  if (!product) throw new NotFoundError('Producto no encontrado');
  return product;
}

export async function requireStockLocation(
  repo: StockLocationRepository,
  organizationId: string,
  id: string,
): Promise<StockLocation> {
  const found = await repo.findById(organizationId, id);
  if (!found) throw new NotFoundError('Lugar de stock no encontrado');
  return found;
}
