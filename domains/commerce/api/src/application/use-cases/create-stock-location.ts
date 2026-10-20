import type { CoreAccessPort } from '@modivara/core-contracts';
import { StockLocation } from '../../domain/stock-location.js';
import { ConflictError } from '../errors.js';
import type { IdGenerator } from '../ports/id-generator.port.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';
import { type StockContext, requireLocation } from './shared.js';

export class CreateStockLocation {
  constructor(
    private readonly stockLocations: StockLocationRepository,
    private readonly core: CoreAccessPort,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: StockContext & { name: string }): Promise<StockLocation> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    const created = StockLocation.create({
      id: this.ids.next(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      name: input.name,
      actorUserId: input.actorUserId,
      now: new Date(),
    });
    if (await this.stockLocations.findActiveByName(input.organizationId, input.locationId, created.name)) {
      throw new ConflictError(`Ya existe un lugar de stock llamado "${created.name}" en el local`);
    }
    await this.stockLocations.save(created);
    return created;
  }
}
