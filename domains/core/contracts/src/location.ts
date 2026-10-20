import type { CoreAccessPort, LocationRef } from './core-access.port.js';

/**
 * Regla única para operar sobre un local: existe, está activo (local y negocio) y es del negocio del actor.
 * Devuelve null en vez de lanzar para que cada dominio use su propio error.
 */
export async function findActiveLocation(
  core: CoreAccessPort,
  organizationId: string,
  locationId: string,
): Promise<LocationRef | null> {
  const location = await core.getLocation(locationId);
  return location?.active && location.organizationId === organizationId ? location : null;
}
