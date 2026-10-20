import { LocationUnavailableError, findActiveLocation } from '@modivara/core-contracts';
import type { ServiceCallMetrics, ServiceCallMetricsQuery } from '@modivara/analytics-contracts';
import { computeServiceCallMetrics, resolveRange } from '../domain/index.js';
import type { CoreAccessPort, ServiceCallFactRepository } from './ports/index.js';

export interface GetServiceCallMetricsInput {
  /** Del contexto autenticado, nunca del cliente. */
  organizationId: string;
  locationId: string;
  query: ServiceCallMetricsQuery;
}

export class GetServiceCallMetrics {
  constructor(
    private readonly facts: ServiceCallFactRepository,
    private readonly core: CoreAccessPort
  ) {}

  async execute(input: GetServiceCallMetricsInput): Promise<ServiceCallMetrics> {
    const location = await findActiveLocation(this.core, input.organizationId, input.locationId);
    if (!location) throw new LocationUnavailableError();

    const { query } = input;
    const range = resolveRange(query, new Date(), location.timezone);
    const facts = await this.facts.findCreatedBetween({
      organizationId: input.organizationId,
      locationId: input.locationId,
      range,
      zoneId: query.zone_id,
      tableId: query.table_id,
    });
    return computeServiceCallMetrics(facts, { timeZone: location.timezone, groupBy: query.group_by, range });
  }
}
