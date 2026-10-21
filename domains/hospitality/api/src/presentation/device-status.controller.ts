import { Controller, Get, Inject, Param } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import { HOSPITALITY_API_PATHS as P, type DeviceStatusDto } from '@modivara/hospitality-contracts';
import { GetDeviceStatus } from '../application/gateways.js';
import { contextOf, CurrentActor, RequireModule, RequirePermission } from './decorators.js';

@Controller()
@RequireModule('hospitality')
export class DeviceStatusController {
  constructor(@Inject(GetDeviceStatus) private readonly status: GetDeviceStatus) {}

  /** Solo booleanos y el estado de conectividad: ni códigos de botón, ni claves, ni ids de gateway. */
  @Get(P.deviceStatus)
  @RequirePermission('hospitality.devices.status')
  async get(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<DeviceStatusDto> {
    const { connectivity, tables } = await this.status.execute(contextOf(actor, locationId));
    return { connectivity, tables: tables.map((t) => ({ table_id: t.tableId, has_button: t.hasButton })) };
  }
}
