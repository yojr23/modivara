import type { CoreAccessPort, LocationRef } from '@modivara/core-contracts';

export class FakeCoreAccess implements CoreAccessPort {
  private readonly locations = new Map<string, LocationRef>();
  add(location: Partial<LocationRef> & Pick<LocationRef, 'id' | 'organizationId'>): LocationRef {
    const ref: LocationRef = { timezone: 'America/Bogota', active: true, ...location };
    this.locations.set(ref.id, ref);
    return ref;
  }
  async getLocation(locationId: string): Promise<LocationRef | null> {
    return this.locations.get(locationId) ?? null;
  }
}
