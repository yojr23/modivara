import type { CoreAccessPort, LocationRef } from '@modivara/core-contracts';
import type { IdGenerator } from '../application/ports/id-generator.port.js';

/** Ids con forma de uuid y orden predecible. */
export class SequentialIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

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
