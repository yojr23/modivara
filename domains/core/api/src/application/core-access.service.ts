import type { CoreAccessPort, LocationRef } from '@modivara/core-contracts';
import type { LocationRepository, OrganizationRepository } from './ports/index.js';

/** Implementación en proceso de `CoreAccessPort`; al separar repositorios se reemplaza por un cliente HTTP. */
export class CoreAccessService implements CoreAccessPort {
  constructor(private readonly locations: LocationRepository,
    private readonly organizations: OrganizationRepository,
  ) {}

  async getLocation(locationId: string): Promise<LocationRef | null> {
    const l = await this.locations.findById(locationId);
    if (!l) return null;
    // Un local de un negocio desactivado no está activo, aunque el local en sí lo esté.
    const org = await this.organizations.findById(l.organizationId);
    return { id: l.id, organizationId: l.organizationId, timezone: l.timezone, active: l.isActive && !!org?.isActive };
  }
}
