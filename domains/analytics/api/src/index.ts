export { ANALYTICS_EVENT_SUBSCRIBER, ANALYTICS_PRISMA, AnalyticsModule, type AnalyticsModuleOptions } from './analytics.module.js';
export {
  AnalyticsEventSubscriber,
  GetInventoryMetrics,
  GetServiceCallMetrics,
  ProjectEvent,
  RebuildProjections,
} from './application/index.js';
export type {
  CoreAccessPort,
  EventSubscriber,
  GetInventoryMetricsInput,
  GetServiceCallMetricsInput,
  LocationRef,
  ProcessedEventStore,
  ProjectionResult,
  RebuildSummary,
  ServiceCallFactQuery,
  ServiceCallFactRepository,
  StockMovementFactQuery,
  StockMovementFactRepository,
} from './application/index.js';
export { EventOutOfOrderError, InvalidEventError, TenantMismatchError } from './domain/index.js';
export {
  createAnalyticsPrisma,
  PrismaProcessedEventStore,
  PrismaServiceCallFactRepository,
  PrismaStockMovementFactRepository,
} from './infrastructure/prisma/index.js';
export type { AnalyticsPrisma } from './infrastructure/prisma/index.js';
