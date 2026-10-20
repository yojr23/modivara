import { LocationUnavailableError, findActiveLocation } from '@modivara/core-contracts';
import type { InventoryMetrics, InventoryMetricsQuery } from '@modivara/analytics-contracts';
import { computeInventoryMetrics, resolveRange } from '../domain/index.js';
import type { CoreAccessPort, StockMovementFactRepository } from './ports/index.js';

export interface GetInventoryMetricsInput {
  organizationId: string;
  locationId: string;
  query: InventoryMetricsQuery;
}

export class GetInventoryMetrics {
  constructor(
    private readonly facts: StockMovementFactRepository,
    private readonly core: CoreAccessPort
  ) {}

  async execute(input: GetInventoryMetricsInput): Promise<InventoryMetrics> {
    const location = await findActiveLocation(this.core, input.organizationId, input.locationId);
    if (!location) throw new LocationUnavailableError();

    const { query } = input;
    const range = resolveRange(query, new Date(), location.timezone);
    const scope = {
      organizationId: input.organizationId,
      locationId: input.locationId,
      productId: query.product_id,
      stockLocationId: query.stock_location_id,
    };
    const [movements, latest] = await Promise.all([
      this.facts.findOccurredBetween({ ...scope, range }),
      this.facts.findLatestPerPlaceAndProduct(scope),
    ]);
    return computeInventoryMetrics(movements, latest, { timeZone: location.timezone, groupBy: query.group_by, range });
  }
}
