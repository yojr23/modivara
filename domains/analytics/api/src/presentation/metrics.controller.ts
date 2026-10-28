import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  ANALYTICS_API_PATHS as P, inventoryMetricsQuerySchema, serviceCallMetricsQuerySchema, type InventoryMetrics, type ServiceCallMetrics,
} from '@modivara/analytics-contracts';
import { GetInventoryMetrics, GetServiceCallMetrics } from '../application/index.js';
import { contextOf, CurrentActor, RequireModule, RequirePermission } from './decorators.js';

// La query inválida lanza ZodError: el filtro global de core lo responde 400.
@Controller()
@RequireModule('analytics')
export class MetricsController {
  constructor(
    @Inject(GetServiceCallMetrics) private readonly serviceCalls: GetServiceCallMetrics,
    @Inject(GetInventoryMetrics) private readonly inventory: GetInventoryMetrics,
  ) {}

  @Get(P.serviceCallMetrics)
  @RequirePermission('analytics.calls.read')
  serviceCallMetrics(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() query: unknown): Promise<ServiceCallMetrics> {
    return this.serviceCalls.execute({ ...contextOf(actor, locationId), query: serviceCallMetricsQuerySchema.parse(query) });
  }

  @Get(P.inventoryMetrics)
  @RequirePermission('analytics.inventory.read')
  inventoryMetrics(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() query: unknown): Promise<InventoryMetrics> {
    return this.inventory.execute({ ...contextOf(actor, locationId), query: inventoryMetricsQuerySchema.parse(query) });
  }
}
