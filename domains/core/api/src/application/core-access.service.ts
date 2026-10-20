import type { CoreAccessPort, LocationRef } from '@modivara/core-contracts';
import type { LocationRepository } from './ports/index.js';

/** Implementación en proceso de `CoreAccessPort`; al separar repositorios se reemplaza por un cliente HTTP. */
export class CoreAccessService implements CoreAccessPort {
  constructor(private readonly locations: LocationRepository) {}

  async getLocation(locationId: string): Promise<LocationRef | null> {
    const l = await this.locations.findById(locationId);
    return l ? { id: l.id, organizationId: l.organizationId, timezone: l.timezone, active: l.isActive } : null;
  }
}
