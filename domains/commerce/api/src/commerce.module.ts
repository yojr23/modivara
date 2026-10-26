import { Inject, Logger, Module, Optional, type DynamicModule, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  CORE_ACCESS_PORT, INTEGRATION_EVENT_SUBSCRIBERS, OutboxPoller, outboxOptionsFromEnv, type IntegrationEventSubscriber, type OutboxPollerOptions,
} from '@modivara/core-contracts';
import {
  AdjustToCount, CreateMovementReason, CreateProduct, CreateStockLocation, DeactivateMovementReason, DeactivateProduct, EnsureDefaultStockLocation,
  GetBalances, ListMovementReasons, ListMovements, ListProducts, ListStockLocations, MovementRecorder, RegisterMovement, SeedMovementReasons,
  UpdateProduct,
} from './application/index.js';
import type { MovementReasonRepository, ProductRepository, StockLedger, StockLocationRepository, StockQueries } from './application/ports/index.js';
import {
  createCommercePrisma, PrismaMovementReasonRepository, PrismaProductRepository, PrismaStockLedger, PrismaStockLocationRepository, type CommercePrisma,
} from './infrastructure/prisma/index.js';
import { CatalogController, LocationCreatedSubscriber, ReasonsController, StockController } from './presentation/index.js';

// Tokens de inyección de los puertos (strings: no dependen de identidad de clase ni de módulos duplicados).
export const COMMERCE_PRISMA = 'COMMERCE_PRISMA';
/** Suscriptor a `core.location.created`; el host lo registra bajo INTEGRATION_EVENT_SUBSCRIBERS. */
export const COMMERCE_EVENT_SUBSCRIBER = 'COMMERCE_EVENT_SUBSCRIBER';
/** Poller del outbox propio (para `tick()` en pruebas y el comando de reintento). */
export const COMMERCE_OUTBOX = 'COMMERCE_OUTBOX';
export const PRODUCTS = 'COMMERCE_PRODUCTS';
export const STOCK_LOCATIONS = 'COMMERCE_STOCK_LOCATIONS';
export const REASONS = 'COMMERCE_REASONS';
/** Una sola instancia hace de `StockLedger` (escrituras) y de `StockQueries` (lecturas). */
export const LEDGER = 'COMMERCE_LEDGER';

export interface CommerceModuleOptions {
  /** Por defecto, `COMMERCE_DATABASE_URL` del entorno. */
  databaseUrl?: string;
  /** Poller del outbox. Por defecto `OUTBOX_POLL_INTERVAL_MS` y valores del poller; `false` = no arranca. */
  outbox?: Partial<OutboxPollerOptions> | false;
}

const CORE = CORE_ACCESS_PORT;

/** Casos de uso: token = la clase, deps = tokens de puertos en el orden de su constructor. */
const useCases = [
  [ListProducts, [PRODUCTS, CORE]],
  [CreateProduct, [PRODUCTS, CORE]],
  [UpdateProduct, [PRODUCTS, CORE]],
  [DeactivateProduct, [PRODUCTS, CORE]],
  [EnsureDefaultStockLocation, [STOCK_LOCATIONS, CORE]],
  [ListStockLocations, [STOCK_LOCATIONS, CORE]],
  [CreateStockLocation, [STOCK_LOCATIONS, CORE]],
  [ListMovementReasons, [REASONS]],
  [SeedMovementReasons, [REASONS]],
  [CreateMovementReason, [REASONS]],
  [DeactivateMovementReason, [REASONS]],
  [MovementRecorder, [PRODUCTS, STOCK_LOCATIONS, REASONS, LEDGER, CORE]],
  [RegisterMovement, [MovementRecorder]],
  [AdjustToCount, [MovementRecorder]],
  [GetBalances, [LEDGER, CORE]],
  [ListMovements, [LEDGER, CORE]],
] as const;

const repo = <T>(provide: string, make: (p: CommercePrisma) => T) => ({ provide, inject: [COMMERCE_PRISMA], useFactory: make });

@Module({})
export class CommerceModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(COMMERCE_PRISMA) private readonly prisma: CommercePrisma,
    @Optional() @Inject(COMMERCE_OUTBOX) private readonly outbox?: OutboxPoller,
  ) {}

  onModuleInit() {
    this.outbox?.start();
  }

  /** `CORE_ACCESS_PORT` lo exporta CoreModule (global): este módulo no importa core-api (ADR-002 D1). Los guards globales de core protegen los controladores. */
  static forRoot(options: CommerceModuleOptions = {}): DynamicModule {
    const databaseUrl = options.databaseUrl ?? process.env.COMMERCE_DATABASE_URL;
    return {
      module: CommerceModule,
      controllers: [CatalogController, ReasonsController, StockController],
      providers: [
        {
          provide: COMMERCE_PRISMA,
          useFactory: () => {
            if (!databaseUrl) throw new Error('COMMERCE_DATABASE_URL is required (or pass databaseUrl to CommerceModule.forRoot)');
            return createCommercePrisma(databaseUrl);
          },
        },
        repo(PRODUCTS, (p): ProductRepository => new PrismaProductRepository(p)),
        repo(STOCK_LOCATIONS, (p): StockLocationRepository => new PrismaStockLocationRepository(p)),
        repo(REASONS, (p): MovementReasonRepository => new PrismaMovementReasonRepository(p)),
        repo(LEDGER, (p): StockLedger & StockQueries => new PrismaStockLedger(p)),
        // Los suscriptores los registra el host bajo INTEGRATION_EVENT_SUBSCRIBERS (multi-proveedor); sin ninguno, igual se marca despachado.
        ...(options.outbox === false
          ? []
          : [{
              provide: COMMERCE_OUTBOX,
              inject: [COMMERCE_PRISMA, { token: INTEGRATION_EVENT_SUBSCRIBERS, optional: true }],
              useFactory: (p: CommercePrisma, subscribers?: IntegrationEventSubscriber[]) =>
                new OutboxPoller(p, subscribers ?? [], { ...outboxOptionsFromEnv(), ...options.outbox }, new Logger('commerce-outbox')),
            }]),
        {
          provide: COMMERCE_EVENT_SUBSCRIBER,
          inject: [SeedMovementReasons, EnsureDefaultStockLocation],
          useFactory: (s: SeedMovementReasons, e: EnsureDefaultStockLocation) => new LocationCreatedSubscriber(s, e),
        },
        ...useCases.map(([useCase, deps]) => ({
          provide: useCase,
          inject: [...deps],
          useFactory: (...args: unknown[]) => new (useCase as new (...a: unknown[]) => unknown)(...args),
        })),
      ],
      exports: [COMMERCE_EVENT_SUBSCRIBER, ...useCases.map(([useCase]) => useCase)],
    };
  }

  async onModuleDestroy() {
    await this.outbox?.stop();
    await this.prisma.$disconnect();
  }
}
