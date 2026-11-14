import { Inject, Logger, Module, Optional, type DynamicModule, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  CORE_ACCESS_PORT, INTEGRATION_EVENT_SUBSCRIBERS, OutboxPoller, outboxOptionsFromEnv, readOutboxHistory, type CoreAccessPort, type EventHistoryReader,
  type IntegrationEventSubscriber, type OutboxPollerOptions,
} from '@modivara/core-contracts';
import { POS_EVENT_HISTORY } from '@modivara/pos-contracts';
import {
  AddSaleLine, CompleteSale, CreateSellableItem, DeactivateSellableItem, GetPosSettings, GetSale, ListSales, ListSellableItems, OpenLinkedSale, OpenSale,
  UpdatePosSettings, UpdateSellableItem, VoidSale, VoidSaleLine,
} from './application/index.js';
import type { ExternalReferenceValidator, PosSettingsRepository, SaleStore, SellableItemRepository } from './application/ports.js';
import { createPosPrisma, type PosPrisma } from './infrastructure/prisma/client.js';
import { PrismaPosSettingsRepository } from './infrastructure/prisma/prisma-pos-settings-repository.js';
import { PrismaSaleStore } from './infrastructure/prisma/prisma-sale-store.js';
import { PrismaSellableItemRepository } from './infrastructure/prisma/prisma-sellable-item-repository.js';
import { CatalogController, SalesController } from './presentation/index.js';

// Tokens de inyección (strings, como los demás dominios).
export const POS_PRISMA = 'POS_PRISMA';
/** Poller del outbox propio (para `tick()` en pruebas, la sonda de salud y el comando de reintento). */
export const POS_OUTBOX = 'POS_OUTBOX';
/**
 * `ExternalReferenceValidator[]` que registra el host (POS-15, POS-27). Opcional: sin él, `POST links` responde 404
 * para cualquier proveedor. POS nunca importa a los proveedores.
 */
export const POS_REFERENCE_VALIDATORS = 'POS_REFERENCE_VALIDATORS';
export const ITEMS = 'POS_ITEMS';
export const SALES = 'POS_SALES';
export const SETTINGS = 'POS_SETTINGS';

export interface PosModuleOptions {
  /** Por defecto, `POS_DATABASE_URL` del entorno. */
  databaseUrl?: string;
  /** Poller del outbox. Por defecto `OUTBOX_POLL_INTERVAL_MS` y valores del poller; `false` = no arranca. */
  outbox?: Partial<OutboxPollerOptions> | false;
}

const CORE = CORE_ACCESS_PORT;

/** Casos de uso: token = la clase, deps = tokens de puertos en el orden de su constructor. */
const useCases = [
  [ListSellableItems, [ITEMS, CORE]],
  [CreateSellableItem, [ITEMS, SETTINGS, CORE]],
  [UpdateSellableItem, [ITEMS, CORE]],
  [DeactivateSellableItem, [ITEMS, CORE]],
  [GetPosSettings, [SETTINGS, CORE]],
  [UpdatePosSettings, [SETTINGS, CORE]],
  [OpenSale, [SALES, SETTINGS, CORE]],
  [GetSale, [SALES, CORE]],
  [ListSales, [SALES, CORE]],
  [AddSaleLine, [SALES, ITEMS, CORE]],
  [VoidSaleLine, [SALES, CORE]],
  [CompleteSale, [SALES, CORE]],
  [VoidSale, [SALES, CORE]],
] as const;

const repo = <T>(provide: string, make: (p: PosPrisma) => T) => ({ provide, inject: [POS_PRISMA], useFactory: make });

@Module({})
export class PosModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(POS_PRISMA) private readonly prisma: PosPrisma,
    @Optional() @Inject(POS_OUTBOX) private readonly outbox?: OutboxPoller,
  ) {}

  onModuleInit() {
    this.outbox?.start();
  }

  /** `CORE_ACCESS_PORT` lo exporta CoreModule (global): este módulo no importa core-api (ADR-002 D1). Los guards globales de core protegen los controladores. */
  static forRoot(options: PosModuleOptions = {}): DynamicModule {
    const databaseUrl = options.databaseUrl ?? process.env.POS_DATABASE_URL;
    return {
      module: PosModule,
      controllers: [CatalogController, SalesController],
      providers: [
        {
          provide: POS_PRISMA,
          useFactory: () => {
            if (!databaseUrl) throw new Error('POS_DATABASE_URL is required (or pass databaseUrl to PosModule.forRoot)');
            return createPosPrisma(databaseUrl);
          },
        },
        repo(ITEMS, (p): SellableItemRepository => new PrismaSellableItemRepository(p)),
        repo(SALES, (p): SaleStore => new PrismaSaleStore(p)),
        repo(SETTINGS, (p): PosSettingsRepository => new PrismaPosSettingsRepository(p)),
        // POS no consume eventos; el poller recibe la lista común del host y cada suscriptor filtra por `handles(event_type)`.
        ...(options.outbox === false
          ? []
          : [{
              provide: POS_OUTBOX,
              inject: [POS_PRISMA, { token: INTEGRATION_EVENT_SUBSCRIBERS, optional: true }],
              useFactory: (p: PosPrisma, subscribers?: IntegrationEventSubscriber[]) =>
                new OutboxPoller(p, subscribers ?? [], { ...outboxOptionsFromEnv(), ...options.outbox }, new Logger('pos-outbox')),
            }]),
        { provide: POS_EVENT_HISTORY, inject: [POS_PRISMA], useFactory: (p: PosPrisma): EventHistoryReader => ({ read: () => readOutboxHistory(p) }) },
        {
          provide: OpenLinkedSale,
          inject: [SALES, SETTINGS, { token: POS_REFERENCE_VALIDATORS, optional: true }, CORE],
          useFactory: (s: SaleStore, st: PosSettingsRepository, v: ExternalReferenceValidator[] | undefined, c: CoreAccessPort) =>
            new OpenLinkedSale(s, st, v ?? [], c),
        },
        ...useCases.map(([useCase, deps]) => ({
          provide: useCase,
          inject: [...deps],
          useFactory: (...args: unknown[]) => new (useCase as new (...a: unknown[]) => unknown)(...args),
        })),
      ],
      exports: [POS_EVENT_HISTORY, ...(options.outbox === false ? [] : [POS_OUTBOX]), OpenLinkedSale, ...useCases.map(([useCase]) => useCase)],
    };
  }

  async onModuleDestroy() {
    await this.outbox?.stop();
    await this.prisma.$disconnect();
  }
}
