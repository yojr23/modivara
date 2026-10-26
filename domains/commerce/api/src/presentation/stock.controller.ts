import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  adjustToCountSchema, type BalanceDto, COMMERCE_API_PATHS as P, idempotencyKeySchema, type MovementDto, type RecordedMovementDto,
  registerMovementSchema, stockQuerySchema,
} from '@modivara/commerce-contracts';
import { AdjustToCount, GetBalances, ListMovements, RegisterMovement, type RecordedMovement } from '../application/index.js';
import type { StockBalance } from '../domain/stock-balance.js';
import type { StockMovement } from '../domain/stock-movement.js';
import { CommerceErrorFilter } from './commerce-error.filter.js';
import { contextOf, CurrentActor, RequireModule, RequirePermission } from './decorators.js';

type StatusRes = { status(code: number): unknown };

const toBalance = (b: StockBalance): BalanceDto => ({
  stock_location_id: b.stockLocationId, product_id: b.productId, quantity: b.quantity.toString(), updated_at: b.updatedAt.toISOString(),
});
const toMovement = (m: StockMovement): MovementDto => ({
  id: m.id, stock_location_id: m.stockLocationId, product_id: m.productId, direction: m.direction, reason_id: m.reasonId, delta: m.delta.toString(),
  balance_after: m.balanceAfter.toString(), note: m.note, actor_user_id: m.actorUserId, occurred_at: m.occurredAt.toISOString(),
});

@Controller()
@UseFilters(CommerceErrorFilter)
@RequireModule('commerce')
export class StockController {
  constructor(
    @Inject(GetBalances) private readonly getBalances: GetBalances,
    @Inject(ListMovements) private readonly listMovements: ListMovements,
    @Inject(RegisterMovement) private readonly registerMovement: RegisterMovement,
    @Inject(AdjustToCount) private readonly adjustToCount: AdjustToCount,
  ) {}

  @Get(P.balances)
  @RequirePermission('commerce.stock.read')
  async balances(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() query: unknown): Promise<BalanceDto[]> {
    const q = stockQuerySchema.parse(query);
    return (await this.getBalances.execute({ ...contextOf(actor, locationId), stockLocationId: q.stock_location_id, productId: q.product_id })).map(toBalance);
  }

  @Get(P.movements)
  @RequirePermission('commerce.stock.read')
  async movements(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() query: unknown): Promise<MovementDto[]> {
    const q = stockQuerySchema.parse(query);
    const found = await this.listMovements.execute({
      ...contextOf(actor, locationId), stockLocationId: q.stock_location_id, productId: q.product_id, limit: q.limit,
    });
    return found.map(toMovement);
  }

  @Post(P.movements)
  @RequirePermission('commerce.stock.write')
  async register(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<RecordedMovementDto> {
    const idempotencyKey = idempotencyKeySchema.parse(key);
    const dto = registerMovementSchema.parse(body);
    const recorded = await this.registerMovement.execute({
      ...contextOf(actor, locationId), stockLocationId: dto.stock_location_id, productId: dto.product_id, reasonId: dto.reason_id,
      direction: dto.direction, quantity: dto.quantity, note: dto.note, idempotencyKey,
    });
    return reply(recorded, res);
  }

  @Post(P.countAdjustments)
  @RequirePermission('commerce.stock.write')
  async count(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<RecordedMovementDto> {
    const idempotencyKey = idempotencyKeySchema.parse(key);
    const dto = adjustToCountSchema.parse(body);
    const recorded = await this.adjustToCount.execute({
      ...contextOf(actor, locationId), stockLocationId: dto.stock_location_id, productId: dto.product_id, reasonId: dto.reason_id,
      countedQuantity: dto.counted_quantity, note: dto.note, idempotencyKey,
    });
    return reply(recorded, res);
  }
}

/** 201 si es nuevo; 200 si la clave ya existía y se devuelve el movimiento original. */
function reply({ movement, replayed }: RecordedMovement, res: StatusRes): RecordedMovementDto {
  res.status(replayed ? 200 : 201);
  return { movement: toMovement(movement), replayed };
}
