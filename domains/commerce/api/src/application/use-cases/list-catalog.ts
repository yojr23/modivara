import type { CoreAccessPort } from '@modivara/core-contracts';
import type { MovementReason } from '../../domain/movement-reason.js';
import type { Product } from '../../domain/product.js';
import type { StockLocation } from '../../domain/stock-location.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ProductRepository } from '../ports/product.repository.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';
import { type ActorContext, type StockContext, requireLocation } from './shared.js';

export class ListProducts {
  constructor(private readonly products: ProductRepository, private readonly core: CoreAccessPort) {}

  async execute(input: StockContext): Promise<Product[]> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    return this.products.list(input);
  }
}

export class ListStockLocations {
  constructor(private readonly stockLocations: StockLocationRepository, private readonly core: CoreAccessPort) {}

  async execute(input: StockContext): Promise<StockLocation[]> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    return this.stockLocations.list(input);
  }
}

export class ListMovementReasons {
  constructor(private readonly reasons: MovementReasonRepository) {}

  async execute(input: ActorContext): Promise<MovementReason[]> {
    return this.reasons.list(input);
  }
}
