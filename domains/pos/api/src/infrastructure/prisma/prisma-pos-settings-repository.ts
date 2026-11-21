import type { LocationScope, PosSettingsRepository } from '../../application/ports.js';
import { DEFAULT_CURRENCY } from '../../application/use-cases.js';
import type { PosPrisma } from './client.js';
import { lockCurrency } from './db.js';

export class PrismaPosSettingsRepository implements PosSettingsRepository {
  constructor(private readonly db: PosPrisma) {}

  async findCurrency({ organizationId, locationId }: LocationScope) {
    const r = await this.db.locationSettings.findUnique({ where: { organizationId_locationId: { organizationId, locationId } } });
    return r?.currency ?? null;
  }

  /** Todo sobre el mismo `tx` que tiene el candado exclusivo: no pide más conexiones al pool mientras espera a las altas. */
  changeCurrency({ organizationId, locationId, currency, actorUserId }: LocationScope & { currency: string; actorUserId: string }) {
    return this.db.$transaction(async (tx) => {
      await lockCurrency(tx, locationId, 'exclusive');
      const key = { organizationId_locationId: { organizationId, locationId } };
      const current = (await tx.locationSettings.findUnique({ where: key }))?.currency ?? DEFAULT_CURRENCY;
      if (current !== currency
        && ((await tx.sellableItem.count({ where: { organizationId, locationId, deactivatedAt: null, currency: { not: currency } } })) > 0
          || (await tx.sale.count({ where: { organizationId, locationId, status: 'open' } })) > 0)) return 'locked' as const;
      const data = { currency, updatedAt: new Date(), updatedBy: actorUserId };
      await tx.locationSettings.upsert({ where: key, create: { organizationId, locationId, ...data }, update: data });
      return 'ok' as const;
    }, { timeout: 15_000, maxWait: 15_000 });
  }
}
