import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import { createTableSchema, HOSPITALITY_API_PATHS as P, updateTableSchema, type TableDto } from '@modivara/hospitality-contracts';
import { CreateTable, DeactivateTable, ListTables, UpdateTable, type TableView } from '../application/zones-and-tables.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';
import { HospitalityConflictFilter } from './conflict.filter.js';

const toDto = ({ table, zoneName }: TableView): TableDto => ({
  id: table.id, label: table.label, zone_id: table.zoneId, zone_name: zoneName, display_name: table.displayName(zoneName), position: table.position,
});

@Controller()
@UseFilters(HospitalityConflictFilter)
@RequireModule('hospitality')
@RequirePermission('hospitality.tables.manage')
export class TablesController {
  constructor(
    @Inject(ListTables) private readonly list: ListTables,
    @Inject(CreateTable) private readonly create: CreateTable,
    @Inject(UpdateTable) private readonly update: UpdateTable,
    @Inject(DeactivateTable) private readonly deactivate: DeactivateTable,
  ) {}

  @Get(P.tables)
  async index(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<TableDto[]> {
    return (await this.list.execute(contextOf(actor, locationId))).map(toDto);
  }

  @Post(P.tables)
  async add(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<TableDto> {
    const input = createTableSchema.parse(body);
    const ctx = contextOf(actor, locationId);
    const table = await this.create.execute({ ...ctx, label: input.label, zoneId: input.zone_id ?? null, ...(input.position !== undefined && { position: input.position }) });
    return this.one(ctx, table.id);
  }

  @Patch(P.table)
  async edit(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('tableId') rawTableId: string, @Body() body: unknown,
  ): Promise<TableDto> {
    const tableId = idOf(rawTableId);
    const { zone_id, ...rest } = updateTableSchema.parse(body);
    const ctx = contextOf(actor, locationId);
    await this.update.execute({ ...ctx, tableId, ...rest, ...(zone_id !== undefined && { zoneId: zone_id }) });
    return this.one(ctx, tableId);
  }

  @Post(P.tableDeactivate)
  @HttpCode(204)
  async remove(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('tableId') rawTableId: string): Promise<void> {
    await this.deactivate.execute({ ...contextOf(actor, locationId), tableId: idOf(rawTableId) });
  }

  private async one(ctx: ReturnType<typeof contextOf>, tableId: string): Promise<TableDto> {
    return toDto((await this.list.execute({ ...ctx, tableId }))[0]!);
  }
}
