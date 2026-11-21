import type { LocationScope, PosSettingsRepository } from '../../application/ports.js';
import type { PosPrisma } from './client.js';
import { lockCurrency } from './db.js';

export class PrismaPosSettingsRepository implements PosSettingsRepository {
  constructor(private readonly db: PosPrisma) {}

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

  /**
   * ponytail: `fn` usa otras conexiones del pool mientras esta transacción solo guarda el candado; con el pool agotado por altas
   * esperando el candado fallaría por timeout del pool (no se cuelga). Si hace falta, pasar la transacción a `fn`.
   */
  withCurrencyLock<T>({ locationId }: LocationScope, fn: () => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await lockCurrency(tx, locationId, 'exclusive');
      return fn();
    }, { timeout: 15_000, maxWait: 15_000 });
  }
}
