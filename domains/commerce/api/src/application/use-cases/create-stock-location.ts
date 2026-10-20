import { type CoreAccessPort, newId } from '@modivara/core-contracts';
import { StockLocation } from '../../domain/stock-location.js';
import { ConflictError } from '../../domain/errors.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';
import { type StockContext, requireLocation } from './shared.js';

export class CreateStockLocation {
  constructor(
    private readonly stockLocations: StockLocationRepository,
    private readonly core: CoreAccessPort,
  ) {}

  async execute(input: StockContext & { name: string }): Promise<StockLocation> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    const created = StockLocation.create({
      id: newId(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      name: input.name,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
    if (await this.stockLocations.findActiveByName({ organizationId: input.organizationId, locationId: input.locationId, name: created.name })) {
      throw new ConflictError(`A stock location named "${created.name}" already exists in the location`);
    }
    await this.stockLocations.save(created);
    return created;
  }
}
