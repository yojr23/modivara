import type { CoreAccessPort } from '@modivara/core-contracts';
import { StockLocation } from '../../domain/stock-location.js';
import type { IdGenerator } from '../ports/id-generator.port.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';
import { type StockContext, requireLocation } from './shared.js';

/** Idempotente: crea "Principal" para el local si aún no hay predeterminado activo. */
export class EnsureDefaultStockLocation {
  constructor(
    private readonly stockLocations: StockLocationRepository,
    private readonly core: CoreAccessPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: StockContext): Promise<StockLocation> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    const existing = await this.stockLocations.findActiveDefault(input.organizationId, input.locationId);
    if (existing) return existing;
    const created = StockLocation.create({
      id: this.ids.next(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      isDefault: true,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
    await this.stockLocations.save(created);
    return created;
  }
}
