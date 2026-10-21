import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { CORE_ACCESS_PORT } from '@modivara/core-contracts';
import {
  AcknowledgeCall, AssignDevice, CompleteCall, CreateGateway, CreateTable, CreateZone, DeactivateTable, DeactivateZone, GetConnectivity,
  GetDeviceStatus, ListActiveCalls, ListDevices, ListTables, ListUnknownDevices, ListZones, UpdateZone, RecordHeartbeat, RegisterButtonPress, RegisterDevice, UpdateTable, UnassignDevice,
} from './application/index.js';
import type {
  ButtonPressStore, DeviceAssignmentRepository, DeviceEventRepository, DeviceRepository, DiningTableRepository, GatewayRepository,
  LocationSettingsRepository, NotificationPort, ServiceCallRepository, ZoneRepository,
} from './application/ports/index.js';
import { DeviceStatusController, PlatformController, TablesController, ZonesController } from './presentation/index.js';
import { GatewayPressAdapter, NoopNotificationPort } from './infrastructure/index.js';
import {
  createHospitalityPrisma, PrismaButtonPressStore, PrismaDeviceAssignmentRepository, PrismaDeviceEventRepository, PrismaDeviceRepository,
  PrismaDiningTableRepository, PrismaGatewayRepository, PrismaLocationSettingsRepository, PrismaServiceCallRepository, PrismaZoneRepository, type HospitalityPrisma,
} from './infrastructure/prisma/index.js';

// Tokens de inyección de los puertos (strings: no dependen de identidad de clase ni de módulos duplicados).
export const HOSPITALITY_PRISMA = 'HOSPITALITY_PRISMA';
export const ZONES = 'HOSPITALITY_ZONES';
export const TABLES = 'HOSPITALITY_TABLES';
export const DEVICES = 'HOSPITALITY_DEVICES';
export const ASSIGNMENTS = 'HOSPITALITY_ASSIGNMENTS';
export const GATEWAYS = 'HOSPITALITY_GATEWAYS';
export const CALLS = 'HOSPITALITY_CALLS';
export const DEVICE_EVENTS = 'HOSPITALITY_DEVICE_EVENTS';
export const SETTINGS = 'HOSPITALITY_SETTINGS';
export const PRESS_STORE = 'HOSPITALITY_PRESS_STORE';
export const NOTIFICATIONS = 'HOSPITALITY_NOTIFICATIONS';

export interface HospitalityModuleOptions {
  /** Por defecto, `HOSPITALITY_DATABASE_URL` del entorno. */
  databaseUrl?: string;
}

const CORE = CORE_ACCESS_PORT;

/** Casos de uso: token = la clase, deps = tokens de puertos en el orden de su constructor. */
const useCases = [
  [CreateZone, [CORE, ZONES]],
  [CreateTable, [CORE, ZONES, TABLES]],
  [UpdateTable, [CORE, ZONES, TABLES]],
  [ListZones, [CORE, ZONES]],
  [UpdateZone, [CORE, ZONES]],
  [DeactivateZone, [CORE, ZONES, TABLES]],
  [ListTables, [CORE, ZONES, TABLES]],
  [ListDevices, [CORE, DEVICES, ASSIGNMENTS]],
  [DeactivateTable, [CORE, TABLES, ASSIGNMENTS]],
  [RegisterDevice, [CORE, DEVICES]],
  [AssignDevice, [DEVICES, TABLES, ASSIGNMENTS]],
  [UnassignDevice, [ASSIGNMENTS]],
  [ListUnknownDevices, [DEVICE_EVENTS, CORE]],
  [CreateGateway, [CORE, GATEWAYS]],
  [RecordHeartbeat, [GATEWAYS]],
  [GetConnectivity, [CORE, GATEWAYS]],
  [GetDeviceStatus, [CORE, TABLES, ASSIGNMENTS, GetConnectivity]],
  [ListActiveCalls, [CORE, CALLS, TABLES, ZONES, SETTINGS]],
  [AcknowledgeCall, [CALLS, NOTIFICATIONS]],
  [CompleteCall, [CALLS, NOTIFICATIONS]],
  [RegisterButtonPress, [CORE, DEVICES, ASSIGNMENTS, TABLES, ZONES, PRESS_STORE, NOTIFICATIONS]],
  [GatewayPressAdapter, [GATEWAYS]],
] as const;

const repo = <T>(provide: string, make: (p: HospitalityPrisma) => T) => ({ provide, inject: [HOSPITALITY_PRISMA], useFactory: make });

@Module({})
export class HospitalityModule implements OnModuleDestroy {
  constructor(@Inject(HOSPITALITY_PRISMA) private readonly prisma: HospitalityPrisma) {}

  /** `CORE_ACCESS_PORT` lo exporta CoreModule (global): este módulo no importa core-api (ADR-002 D1). Los guards globales de core protegen los controladores. */
  static forRoot(options: HospitalityModuleOptions = {}): DynamicModule {
    const databaseUrl = options.databaseUrl ?? process.env.HOSPITALITY_DATABASE_URL;
    return {
      module: HospitalityModule,
      controllers: [ZonesController, TablesController, DeviceStatusController, PlatformController],
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
        repo(CALLS, (p): ServiceCallRepository => new PrismaServiceCallRepository(p)),
        repo(DEVICE_EVENTS, (p): DeviceEventRepository => new PrismaDeviceEventRepository(p)),
        repo(PRESS_STORE, (p): ButtonPressStore => new PrismaButtonPressStore(p)),
        { provide: NOTIFICATIONS, useFactory: (): NotificationPort => new NoopNotificationPort() },
        ...useCases.map(([useCase, deps]) => ({
          provide: useCase,
          inject: [...deps],
          useFactory: (...args: unknown[]) => new (useCase as new (...a: unknown[]) => unknown)(...args),
        })),
      ],
      exports: useCases.map(([useCase]) => useCase),
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
