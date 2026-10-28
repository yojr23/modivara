import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { CORE_ACCESS_PORT, type IntegrationEvent, type IntegrationEventSubscriber } from '@modivara/core-contracts';
import {
  AnalyticsEventSubscriber, buildEventRegistry, GetInventoryMetrics, GetServiceCallMetrics, ProjectEvent, RebuildProjections, type EventRegistry,
} from './application/index.js';
import {
  createAnalyticsPrisma, PrismaProcessedEventStore, PrismaServiceCallFactRepository, PrismaStockMovementFactRepository, type AnalyticsPrisma,
} from './infrastructure/prisma/index.js';

// Tokens de inyección de los puertos (strings, como en commerce).
export const ANALYTICS_PRISMA = 'ANALYTICS_PRISMA';
/** Suscriptor a los eventos de hospitality y commerce; el host lo registra bajo INTEGRATION_EVENT_SUBSCRIBERS. */
export const ANALYTICS_EVENT_SUBSCRIBER = 'ANALYTICS_EVENT_SUBSCRIBER';
export const SERVICE_CALL_FACTS = 'ANALYTICS_SERVICE_CALL_FACTS';
export const STOCK_MOVEMENT_FACTS = 'ANALYTICS_STOCK_MOVEMENT_FACTS';
export const PROCESSED_EVENTS = 'ANALYTICS_PROCESSED_EVENTS';
export const EVENT_REGISTRY = 'ANALYTICS_EVENT_REGISTRY';

export interface AnalyticsModuleOptions {
  /** Por defecto, `ANALYTICS_DATABASE_URL` del entorno. */
  databaseUrl?: string;
}

const CORE = CORE_ACCESS_PORT;

/** Casos de uso: token = la clase, deps = tokens de puertos en el orden de su constructor. */
const useCases = [
  [ProjectEvent, [EVENT_REGISTRY, PROCESSED_EVENTS]],
  [AnalyticsEventSubscriber, [ProjectEvent]],
  [GetServiceCallMetrics, [SERVICE_CALL_FACTS, CORE]],
  [GetInventoryMetrics, [STOCK_MOVEMENT_FACTS, CORE]],
  [RebuildProjections, [SERVICE_CALL_FACTS, STOCK_MOVEMENT_FACTS, PROCESSED_EVENTS, AnalyticsEventSubscriber]],
] as const;

const repo = <T>(provide: string, make: (p: AnalyticsPrisma) => T) => ({ provide, inject: [ANALYTICS_PRISMA], useFactory: make });

@Module({})
export class AnalyticsModule implements OnModuleDestroy {
  constructor(@Inject(ANALYTICS_PRISMA) private readonly prisma: AnalyticsPrisma) {}

  /** `CORE_ACCESS_PORT` lo exporta CoreModule (global). Analytics no tiene outbox propio: solo consume los de hospitality y commerce. */
  static forRoot(options: AnalyticsModuleOptions = {}): DynamicModule {
    const databaseUrl = options.databaseUrl ?? process.env.ANALYTICS_DATABASE_URL;
    return {
      module: AnalyticsModule,
      providers: [
        {
          provide: ANALYTICS_PRISMA,
          useFactory: () => {
            if (!databaseUrl) throw new Error('ANALYTICS_DATABASE_URL is required (or pass databaseUrl to AnalyticsModule.forRoot)');
            return createAnalyticsPrisma(databaseUrl);
          },
        },
        repo(SERVICE_CALL_FACTS, (p) => new PrismaServiceCallFactRepository(p)),
        repo(STOCK_MOVEMENT_FACTS, (p) => new PrismaStockMovementFactRepository(p)),
        repo(PROCESSED_EVENTS, (p) => new PrismaProcessedEventStore(p)),
        {
          provide: EVENT_REGISTRY,
          inject: [SERVICE_CALL_FACTS, STOCK_MOVEMENT_FACTS],
          useFactory: (calls: PrismaServiceCallFactRepository, stocks: PrismaStockMovementFactRepository) => buildEventRegistry(calls, stocks),
        },
        {
          provide: ANALYTICS_EVENT_SUBSCRIBER,
          inject: [AnalyticsEventSubscriber, EVENT_REGISTRY],
          useFactory: (subscriber: AnalyticsEventSubscriber, registry: EventRegistry): IntegrationEventSubscriber => ({
            name: 'analytics',
            handles: (eventType) => registry.has(eventType),
            handle: (event: IntegrationEvent) => subscriber.handle(event),
          }),
        },
        ...useCases.map(([useCase, deps]) => ({
          provide: useCase,
          inject: [...deps],
          useFactory: (...args: unknown[]) => new (useCase as new (...a: unknown[]) => unknown)(...args),
        })),
      ],
      exports: [ANALYTICS_EVENT_SUBSCRIBER, ...useCases.map(([useCase]) => useCase)],
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
