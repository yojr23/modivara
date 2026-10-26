import { DEFAULT_LOCATION_SETTINGS } from '../../domain/settings/location-settings.js';
import type { LocationSettingsRepository, Scope } from '../../application/ports/index.js';
import type { Db } from './db.js';

export class PrismaLocationSettingsRepository implements LocationSettingsRepository {
  constructor(private readonly db: Db) {}

  async get({ organizationId, locationId }: Scope) {
    const r = await this.db.locationSettings.findFirst({ where: { organizationId, locationId } });
    return r ? { callVisibility: r.callVisibility } : DEFAULT_LOCATION_SETTINGS;
  }

  async ensureDefault({ organizationId, locationId }: Scope, createdBy: string) {
    await this.db.locationSettings.createMany({ data: [{ organizationId, locationId, createdBy }], skipDuplicates: true });
  }
}
