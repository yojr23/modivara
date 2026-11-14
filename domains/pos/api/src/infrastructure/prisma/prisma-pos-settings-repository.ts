import type { LocationScope, PosSettingsRepository } from '../../application/ports.js';
import type { Db } from './db.js';

export class PrismaPosSettingsRepository implements PosSettingsRepository {
  constructor(private readonly db: Db) {}

  async findCurrency({ organizationId, locationId }: LocationScope) {
    const r = await this.db.locationSettings.findUnique({ where: { organizationId_locationId: { organizationId, locationId } } });
    return r?.currency ?? null;
  }

  async saveCurrency({ organizationId, locationId, currency, actorUserId }: LocationScope & { currency: string; actorUserId: string }) {
    const data = { currency, updatedAt: new Date(), updatedBy: actorUserId };
    await this.db.locationSettings.upsert({
      where: { organizationId_locationId: { organizationId, locationId } },
      create: { organizationId, locationId, ...data },
      update: data,
    });
  }
}
