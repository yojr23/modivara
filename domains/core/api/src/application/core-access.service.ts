import type { CoreAccessPort, LocationRef, ModuleName } from '@modivara/core-contracts';
import { isLocationAvailable } from './location-availability.js';
import type { EntitlementRepository, LocationRepository } from './ports/index.js';

/** Implementación en proceso de `CoreAccessPort`; al separar repositorios se reemplaza por un cliente HTTP. */
export class CoreAccessService implements CoreAccessPort {
  constructor(
    private readonly locations: LocationRepository,
    private readonly entitlements: EntitlementRepository,
  ) {}

  async isModuleEnabled(organizationId: string, module: ModuleName): Promise<boolean> {
    return (await this.entitlements.find({ organizationId, module }))?.enabled === true;
  }

  async getLocation(locationId: string): Promise<LocationRef | null> {
    const found = await this.locations.findByIdWithOrganization({ id: locationId });
    if (!found) return null;
    const { location } = found;
    return { id: location.id, organizationId: location.organizationId, timezone: location.timezone, active: isLocationAvailable(found) };
  }
}
