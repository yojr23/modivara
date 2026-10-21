import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  assignDeviceSchema, createDeviceSchema, createGatewaySchema, HOSPITALITY_API_PATHS as P, type DeviceDto, type GatewayCreatedDto, type GatewayDto,
  type UnknownDeviceDto,
} from '@modivara/hospitality-contracts';
import { AssignDevice, ListDevices, ListUnknownDevices, RegisterDevice, UnassignDevice } from '../application/devices.js';
import { CreateGateway, GetConnectivity } from '../application/gateways.js';
import { ValidationError } from '../domain/errors.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';
import { HospitalityConflictFilter } from './conflict.filter.js';

// OPEN: ventana por defecto de «detectados sin asignar» cuando no llega `since` (¿7 días?, ¿hasta cuándo se conservan las señales?).
const DEFAULT_UNKNOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Consola de plataforma: solo superadmin (los `platform.*` solo los tiene él), operando sobre un negocio con `acting_organization_id`.
 * OPEN: ADR-002 D3 pide registrar estas acciones en `core.audit_log`, pero hospitality no puede escribir en core y core-contracts no ofrece
 * un puerto de auditoría ni un evento para ello. Hoy solo queda el usuario en `created_by`/`assigned_by`/`unassigned_by` de cada fila.
 */
@Controller()
@UseFilters(HospitalityConflictFilter)
@RequireModule('hospitality')
export class PlatformController {
  constructor(
    @Inject(CreateGateway) private readonly createGateway: CreateGateway,
    @Inject(GetConnectivity) private readonly connectivity: GetConnectivity,
    @Inject(RegisterDevice) private readonly registerDevice: RegisterDevice,
    @Inject(ListDevices) private readonly listDevices: ListDevices,
    @Inject(ListUnknownDevices) private readonly listUnknown: ListUnknownDevices,
    @Inject(AssignDevice) private readonly assign: AssignDevice,
    @Inject(UnassignDevice) private readonly unassign: UnassignDevice,
  ) {}

  /** La clave en claro solo viaja en esta respuesta; después nadie puede volver a verla. */
  @Post(P.platformGateways)
  @RequirePermission('platform.gateways.manage')
  async addGateway(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<GatewayCreatedDto> {
    const { gateway, plainKey } = await this.createGateway.execute({ ...contextOf(actor, locationId), ...createGatewaySchema.parse(body) });
    return { id: gateway.id, name: gateway.name, key: plainKey };
  }

  @Get(P.platformGateways)
  @RequirePermission('platform.gateways.manage')
  async gateways(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<GatewayDto[]> {
    const { gateways } = await this.connectivity.execute(contextOf(actor, locationId));
    return gateways.map((g) => ({ id: g.gatewayId, name: g.name, last_seen_at: g.lastSeenAt?.toISOString() ?? null, connected: g.connected }));
  }

  @Post(P.platformDevices)
  @RequirePermission('platform.devices.manage')
  async addDevice(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<DeviceDto> {
    const device = await this.registerDevice.execute({ ...contextOf(actor, locationId), ...createDeviceSchema.parse(body) });
    return { id: device.id, code: device.code, model: device.model, table_id: null };
  }

  @Get(P.platformDevices)
  @RequirePermission('platform.devices.manage')
  async devices(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<DeviceDto[]> {
    return (await this.listDevices.execute(contextOf(actor, locationId))).map(({ device, tableId }) => ({
      id: device.id, code: device.code, model: device.model, table_id: tableId,
    }));
  }

  @Get(P.platformUnknownDevices)
  @RequirePermission('platform.devices.manage')
  async unknown(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query('since') since?: string): Promise<UnknownDeviceDto[]> {
    const from = since === undefined ? new Date(Date.now() - DEFAULT_UNKNOWN_WINDOW_MS) : new Date(since);
    if (Number.isNaN(from.getTime())) throw new ValidationError('since must be an ISO date');
    const { organizationId, locationId: location } = contextOf(actor, locationId);
    return (await this.listUnknown.execute({ organizationId, locationId: location, since: from })).map((u) => ({
      device_code: u.deviceCode, first_seen_at: u.firstReceivedAt.toISOString(), last_seen_at: u.lastReceivedAt.toISOString(), count: u.pressCount,
    }));
  }

  @Post(P.platformAssignDevice)
  @HttpCode(204)
  @RequirePermission('platform.device_assignments.manage')
  async assignDevice(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('deviceId') rawDeviceId: string, @Body() body: unknown,
  ): Promise<void> {
    await this.assign.execute({ ...contextOf(actor, locationId), deviceId: idOf(rawDeviceId), tableId: assignDeviceSchema.parse(body).table_id });
  }

  @Post(P.platformUnassignDevice)
  @HttpCode(204)
  @RequirePermission('platform.device_assignments.manage')
  async unassignDevice(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('deviceId') rawDeviceId: string): Promise<void> {
    await this.unassign.execute({ ...contextOf(actor, locationId), deviceId: idOf(rawDeviceId) });
  }
}
