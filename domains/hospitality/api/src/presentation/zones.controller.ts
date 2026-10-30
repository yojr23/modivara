import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import { createZoneSchema, HOSPITALITY_API_PATHS as P, updateZoneSchema, type ZoneDto } from '@modivara/hospitality-contracts';
import { CreateZone, DeactivateZone, ListZones, UpdateZone } from '../application/zones-and-tables.js';
import type { Zone } from '../domain/tables/zone.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';
import { HospitalityConflictFilter } from './conflict.filter.js';

const toDto = (z: Zone): ZoneDto => ({ id: z.id, name: z.name, position: z.position });

@Controller()
@UseFilters(HospitalityConflictFilter)
@RequireModule('hospitality')
@RequirePermission('hospitality.tables.manage')
export class ZonesController {
  constructor(
    @Inject(ListZones) private readonly list: ListZones,
    @Inject(CreateZone) private readonly create: CreateZone,
    @Inject(UpdateZone) private readonly update: UpdateZone,
    @Inject(DeactivateZone) private readonly deactivate: DeactivateZone,
  ) {}

  // Leer zonas también con `calls.read`: el tablero del personal las necesita para nombrar los pisos. Modificar sigue exigiendo tables.manage.
  @Get(P.zones)
  @RequirePermission('hospitality.calls.read')
  async index(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<ZoneDto[]> {
    return (await this.list.execute(contextOf(actor, locationId))).map(toDto);
  }

  @Post(P.zones)
  async add(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<ZoneDto> {
    return toDto(await this.create.execute({ ...contextOf(actor, locationId), ...createZoneSchema.parse(body) }));
  }

  @Patch(P.zone)
  async edit(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('zoneId') rawZoneId: string, @Body() body: unknown,
  ): Promise<ZoneDto> {
    return toDto(await this.update.execute({ ...contextOf(actor, locationId), zoneId: idOf(rawZoneId), ...updateZoneSchema.parse(body) }));
  }

  @Post(P.zoneDeactivate)
  @HttpCode(204)
  async remove(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('zoneId') rawZoneId: string): Promise<void> {
    await this.deactivate.execute({ ...contextOf(actor, locationId), zoneId: idOf(rawZoneId) });
  }
}
