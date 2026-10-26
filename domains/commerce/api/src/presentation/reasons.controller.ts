import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import { COMMERCE_API_PATHS as P, createMovementReasonSchema, type MovementReasonDto } from '@modivara/commerce-contracts';
import { CreateMovementReason, DeactivateMovementReason, ListMovementReasons } from '../application/index.js';
import type { MovementReason } from '../domain/movement-reason.js';
import { CommerceErrorFilter } from './commerce-error.filter.js';
import { CurrentActor, idOf, orgContextOf, RequireModule, RequirePermission } from './decorators.js';

const toReason = (r: MovementReason): MovementReasonDto => ({ id: r.id, name: r.name, direction: r.direction, active: r.isActive });

/** Motivos por negocio: sin `:locationId`, el guard exige el permiso en alguno de los locales del actor. */
@Controller()
@UseFilters(CommerceErrorFilter)
@RequireModule('commerce')
export class ReasonsController {
  constructor(
    @Inject(ListMovementReasons) private readonly list: ListMovementReasons,
    @Inject(CreateMovementReason) private readonly create: CreateMovementReason,
    @Inject(DeactivateMovementReason) private readonly deactivate: DeactivateMovementReason,
  ) {}

  // OPEN: listar motivos con commerce.stock.read (los necesita quien registra movimientos, p. ej. inventory que no gestiona motivos).
  @Get(P.reasons)
  @RequirePermission('commerce.stock.read')
  async index(@CurrentActor() actor: RequestActor): Promise<MovementReasonDto[]> {
    return (await this.list.execute(orgContextOf(actor))).map(toReason);
  }

  @Post(P.reasons)
  @RequirePermission('commerce.reasons.manage')
  async add(@CurrentActor() actor: RequestActor, @Body() body: unknown): Promise<MovementReasonDto> {
    return toReason(await this.create.execute({ ...orgContextOf(actor), ...createMovementReasonSchema.parse(body) }));
  }

  @Post(P.reasonDeactivate)
  @HttpCode(204)
  @RequirePermission('commerce.reasons.manage')
  async remove(@CurrentActor() actor: RequestActor, @Param('reasonId') reasonId: string): Promise<void> {
    await this.deactivate.execute({ ...orgContextOf(actor), reasonId: idOf(reasonId) });
  }
}
