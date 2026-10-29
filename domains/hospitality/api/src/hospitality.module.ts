import { Inject, Logger, Module, Optional, type DynamicModule, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  CORE_ACCESS_PORT, INTEGRATION_EVENT_SUBSCRIBERS, OutboxPoller, outboxOptionsFromEnv, readOutboxHistory, type CoreAccessPort, type EventHistoryReader, type IntegrationEventSubscriber, type OutboxPollerOptions,
} from '@modivara/core-contracts';
import { HOSPITALITY_EVENT_HISTORY } from '@modivara/hospitality-contracts';
import {
  AcknowledgeCall, AssignDevice, CompleteCall, CreateGateway, EnsureLocationSettings, DetectGatewayHealthChanges, CreateTable, CreateZone, DeactivateTable, DeactivateZone, GetConnectivity,
  GetDeviceStatus, GetLayoutDraft, ListActiveCalls, ListPublishedLayouts, PublishLayout, SaveLayoutDraft, ListServiceCalls, GetServiceCall, CallViews, ListDevices, ListTables, ListUnknownDevices, ListZones, UpdateZone, RecordHeartbeat, RegisterButtonPress, RegisterDevice, UpdateTable, UnassignDevice, SeedCallHistory,
} from './application/index.js';
import type {
  ButtonPressStore, CallHistoryStore, DeviceAssignmentRepository, DeviceEventRepository, DeviceRepository, DiningTableRepository, GatewayRepository,
  GatewayHealthNotifier, LayoutRepository, LocationSettingsRepository, NotificationPort, ServiceCallRepository, ZoneRepository,
} from './application/ports/index.js';
import { LocationCreatedSubscriber, DeviceEventsController, LayoutsController, DeviceStatusController, PlatformController, ServiceCallsController, TablesController, ZonesController } from './presentation/index.js';
import { GatewayIngest } from './infrastructure/iot/gateway-ingest.js';
import { GatewayRateLimiter, type GatewayRateLimitOptions } from './infrastructure/iot/gateway-rate-limiter.js';
import { MqttAdapter, type MqttOptions, mqttOptionsFromEnv } from './infrastructure/iot/mqtt.adapter.js';
import { GatewayKeyGuard } from './presentation/gateway-key.guard.js';
import { GatewayHealthMonitor } from './infrastructure/realtime/gateway-health.js';
import { GatewayPressAdapter, RealtimeBroadcaster, RealtimeGateway } from './infrastructure/index.js';
import {
  createHospitalityPrisma, PrismaButtonPressStore, PrismaCallHistoryStore, PrismaDeviceAssignmentRepository, PrismaDeviceEventRepository, PrismaDeviceRepository,
  PrismaDiningTableRepository, PrismaGatewayRepository, PrismaLayoutRepository, PrismaLocationSettingsRepository, PrismaServiceCallRepository, PrismaZoneRepository, type HospitalityPrisma,
} from './infrastructure/prisma/index.js';

// Tokens de inyección de los puertos (strings: no dependen de identidad de clase ni de módulos duplicados).
export const HOSPITALITY_PRISMA = 'HOSPITALITY_PRISMA';
/** Poller del outbox propio (para `tick()` en pruebas y el comando de reintento). */
export const HOSPITALITY_OUTBOX = 'HOSPITALITY_OUTBOX';
/** Suscriptor a `core.location.created`; el host lo registra bajo INTEGRATION_EVENT_SUBSCRIBERS. */
export const HOSPITALITY_EVENT_SUBSCRIBER = 'HOSPITALITY_EVENT_SUBSCRIBER';
export const ZONES = 'HOSPITALITY_ZONES';
export const TABLES = 'HOSPITALITY_TABLES';
export const DEVICES = 'HOSPITALITY_DEVICES';
export const ASSIGNMENTS = 'HOSPITALITY_ASSIGNMENTS';
export const GATEWAYS = 'HOSPITALITY_GATEWAYS';
export const CALLS = 'HOSPITALITY_CALLS';
export const LAYOUTS = 'HOSPITALITY_LAYOUTS';
export const DEVICE_EVENTS = 'HOSPITALITY_DEVICE_EVENTS';
export const SETTINGS = 'HOSPITALITY_SETTINGS';
export const PRESS_STORE = 'HOSPITALITY_PRESS_STORE';
export const CALL_HISTORY_STORE = 'HOSPITALITY_CALL_HISTORY_STORE';
export const NOTIFICATIONS = 'HOSPITALITY_NOTIFICATIONS';
export const GATEWAY_HEALTH_NOTIFIER = 'HOSPITALITY_GATEWAY_HEALTH_NOTIFIER';
export const LAYOUT_NOTIFIER = 'HOSPITALITY_LAYOUT_NOTIFIER';

export interface HospitalityModuleOptions {
  /** Por defecto, `HOSPITALITY_DATABASE_URL` del entorno. */
  databaseUrl?: string;
  /** Broker MQTT. Por defecto `MQTT_URL`/`MQTT_USERNAME`/`MQTT_PASSWORD`; `null` (o faltantes) = el adaptador MQTT no arranca. */
  mqtt?: MqttOptions | null;
  /** Poller del outbox. Por defecto `OUTBOX_POLL_INTERVAL_MS` y valores del poller; `false` = no arranca. */
  outbox?: Partial<OutboxPollerOptions> | false;
  /** Límite de mensajes por gateway (compartido por HTTP y MQTT). Por defecto `DEFAULT_GATEWAY_RATE_LIMIT`. */
  rateLimit?: Partial<GatewayRateLimitOptions>;
}

const CORE = CORE_ACCESS_PORT;

/** Casos de uso: token = la clase, deps = tokens de puertos en el orden de su constructor. */
const useCases = [
  [EnsureLocationSettings, [CORE, SETTINGS]],
  [CreateZone, [CORE, ZONES]],
  [CreateTable, [CORE, ZONES, TABLES]],
  [UpdateTable, [CORE, ZONES, TABLES]],
  [ListZones, [CORE, ZONES]],
  [UpdateZone, [CORE, ZONES]],
  [DeactivateZone, [CORE, ZONES, TABLES]],
  [ListTables, [CORE, ZONES, TABLES]],
  [ListDevices, [CORE, DEVICES, ASSIGNMENTS]],
  [DeactivateTable, [CORE, TABLES, ASSIGNMENTS, CALLS]],
  [RegisterDevice, [CORE, DEVICES]],
  [AssignDevice, [DEVICES, TABLES, ASSIGNMENTS]],
  [UnassignDevice, [ASSIGNMENTS]],
  [ListUnknownDevices, [DEVICE_EVENTS, CORE]],
  [CreateGateway, [CORE, GATEWAYS]],
  [RecordHeartbeat, [CORE, GATEWAYS]],
  [GetConnectivity, [CORE, GATEWAYS]],
  [GetDeviceStatus, [CORE, TABLES, ASSIGNMENTS, GetConnectivity]],
  [ListActiveCalls, [CORE, CALLS, TABLES, ZONES, SETTINGS]],
  [CallViews, [TABLES, ZONES, CORE]],
  [GetServiceCall, [CORE, CALLS, CallViews, SETTINGS]],
  [ListServiceCalls, [CORE, CALLS, CallViews, SETTINGS]],
  [AcknowledgeCall, [CALLS, NOTIFICATIONS]],
  [CompleteCall, [CALLS, NOTIFICATIONS]],
  [ListPublishedLayouts, [CORE, LAYOUTS, ZONES, TABLES]],
  [GetLayoutDraft, [CORE, LAYOUTS, ZONES, TABLES]],
  [SaveLayoutDraft, [CORE, LAYOUTS, ZONES, TABLES]],
  [PublishLayout, [CORE, LAYOUTS, LAYOUT_NOTIFIER]],
  [SeedCallHistory, [CORE, TABLES, ZONES, DEVICES, ASSIGNMENTS, GATEWAYS, CALLS, CALL_HISTORY_STORE]],
  [RegisterButtonPress, [CORE, DEVICES, ASSIGNMENTS, TABLES, ZONES, PRESS_STORE, NOTIFICATIONS]],
  [DetectGatewayHealthChanges, [GATEWAYS, GATEWAY_HEALTH_NOTIFIER]],
  [GatewayPressAdapter, [GATEWAYS, DEVICES]],
  [GatewayIngest, [GatewayPressAdapter, RegisterButtonPress, RecordHeartbeat]],
] as const;

const repo = <T>(provide: string, make: (p: HospitalityPrisma) => T) => ({ provide, inject: [HOSPITALITY_PRISMA], useFactory: make });

@Module({})
export class HospitalityModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(HOSPITALITY_PRISMA) private readonly prisma: HospitalityPrisma,
    @Optional() @Inject(HOSPITALITY_OUTBOX) private readonly outbox?: OutboxPoller,
  ) {}

  onModuleInit() {
    this.outbox?.start();
  }

  /** `CORE_ACCESS_PORT` lo exporta CoreModule (global): este módulo no importa core-api (ADR-002 D1). Los guards globales de core protegen los controladores. */
  static forRoot(options: HospitalityModuleOptions = {}): DynamicModule {
    const databaseUrl = options.databaseUrl ?? process.env.HOSPITALITY_DATABASE_URL;
    return {
      module: HospitalityModule,
      controllers: [ZonesController, TablesController, DeviceStatusController, PlatformController, DeviceEventsController, ServiceCallsController, LayoutsController],
      providers: [
        {
          provide: HOSPITALITY_PRISMA,
          useFactory: () => {
            if (!databaseUrl) throw new Error('HOSPITALITY_DATABASE_URL is required (or pass databaseUrl to HospitalityModule.forRoot)');
            return createHospitalityPrisma(databaseUrl);
          },
        },
        repo(ZONES, (p): ZoneRepository => new PrismaZoneRepository(p)),
        repo(TABLES, (p): DiningTableRepository => new PrismaDiningTableRepository(p)),
        repo(DEVICES, (p): DeviceRepository => new PrismaDeviceRepository(p)),
        repo(ASSIGNMENTS, (p): DeviceAssignmentRepository => new PrismaDeviceAssignmentRepository(p)),
        repo(GATEWAYS, (p): GatewayRepository => new PrismaGatewayRepository(p)),
        repo(SETTINGS, (p): LocationSettingsRepository => new PrismaLocationSettingsRepository(p)),
        repo(LAYOUTS, (p): LayoutRepository => new PrismaLayoutRepository(p)),
        repo(CALLS, (p): ServiceCallRepository => new PrismaServiceCallRepository(p)),
        repo(DEVICE_EVENTS, (p): DeviceEventRepository => new PrismaDeviceEventRepository(p)),
        repo(CALL_HISTORY_STORE, (p): CallHistoryStore => new PrismaCallHistoryStore(p)),
        repo(PRESS_STORE, (p): ButtonPressStore => new PrismaButtonPressStore(p)),
        { provide: GatewayRateLimiter, useFactory: () => new GatewayRateLimiter(options.rateLimit) },
        GatewayKeyGuard,
        RealtimeGateway,
        {
          provide: RealtimeBroadcaster,
          inject: [RealtimeGateway, CORE, CallViews, SETTINGS],
          useFactory: (g: RealtimeGateway, core: CoreAccessPort, v: CallViews, s: LocationSettingsRepository) => new RealtimeBroadcaster(g, core, v, s),
        },
        { provide: GATEWAY_HEALTH_NOTIFIER, useExisting: RealtimeBroadcaster },
        { provide: LAYOUT_NOTIFIER, useExisting: RealtimeBroadcaster },
        { provide: GatewayHealthMonitor, inject: [DetectGatewayHealthChanges], useFactory: (d: DetectGatewayHealthChanges) => new GatewayHealthMonitor(d) },
        {
          provide: MqttAdapter,
          inject: [GatewayPressAdapter, GatewayIngest, GatewayRateLimiter],
          useFactory: (gateways: GatewayPressAdapter, ingest: GatewayIngest, limiter: GatewayRateLimiter) =>
            new MqttAdapter(options.mqtt === undefined ? mqttOptionsFromEnv() : options.mqtt, gateways, ingest, limiter),
        },
        // Los suscriptores los registra el host bajo INTEGRATION_EVENT_SUBSCRIBERS (multi-proveedor); sin ninguno, igual se marca despachado.
        ...(options.outbox === false
          ? []
          : [{
              provide: HOSPITALITY_OUTBOX,
              inject: [HOSPITALITY_PRISMA, { token: INTEGRATION_EVENT_SUBSCRIBERS, optional: true }],
              useFactory: (p: HospitalityPrisma, subscribers?: IntegrationEventSubscriber[]) =>
                new OutboxPoller(p, subscribers ?? [], { ...outboxOptionsFromEnv(), ...options.outbox }, new Logger('hospitality-outbox')),
            }]),
        { provide: HOSPITALITY_EVENT_HISTORY, inject: [HOSPITALITY_PRISMA], useFactory: (p: HospitalityPrisma): EventHistoryReader => ({ read: () => readOutboxHistory(p) }) },
        { provide: NOTIFICATIONS, useExisting: RealtimeBroadcaster },
        { provide: HOSPITALITY_EVENT_SUBSCRIBER, inject: [EnsureLocationSettings], useFactory: (e: EnsureLocationSettings) => new LocationCreatedSubscriber(e) },
        ...useCases.map(([useCase, deps]) => ({
          provide: useCase,
          inject: [...deps],
          useFactory: (...args: unknown[]) => new (useCase as new (...a: unknown[]) => unknown)(...args),
        })),
      ],
      exports: [HOSPITALITY_EVENT_SUBSCRIBER, HOSPITALITY_EVENT_HISTORY, ...useCases.map(([useCase]) => useCase)],
    };
  }

  async onModuleDestroy() {
    await this.outbox?.stop();
    await this.prisma.$disconnect();
  }
}
