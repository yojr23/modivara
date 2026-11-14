import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Res, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  addSaleLineSchema, completeSaleSchema, formatScaled, idempotencyKeySchema, MONEY_SCALE, multiplyMoney, openLinkedSaleSchema, parseSaleCursor,
  POS_API_PATHS as P, QUANTITY_SCALE, type SaleDto, saleQuerySchema, type SaleResultDto,
} from '@modivara/pos-contracts';
import {
  AddSaleLine, CompleteSale, GetSale, ListSales, OpenLinkedSale, OpenSale, type SaleWrite, VoidSale, VoidSaleLine,
} from '../application/index.js';
import type { Sale } from '../domain/sale.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';
import { PosErrorFilter } from './pos-error.filter.js';

type StatusRes = { status(code: number): unknown };

const money = (v: bigint) => formatScaled(v, MONEY_SCALE);

/** Montos y cantidades como texto decimal exacto: un bigint nunca llega a JSON. */
const toSale = (sale: Sale): SaleDto => {
  const s = sale.toProps();
  return {
    id: s.id, currency: s.currency, status: s.status, total: money(sale.total), payment_method: s.paymentMethod,
    opened_at: s.openedAt.toISOString(), opened_by: s.openedBy, closed_at: s.closedAt?.toISOString() ?? null, closed_by: s.closedBy,
    context_label: s.contextLabel,
    lines: s.lines.map((l) => ({
      id: l.id, sellable_item_id: l.sellableItemId, sku: l.skuSnapshot, name: l.nameSnapshot, unit: l.unitSnapshot,
      unit_price: money(l.unitPriceSnapshot), quantity: formatScaled(l.quantity, QUANTITY_SCALE), line_total: money(multiplyMoney(l.unitPriceSnapshot, l.quantity)),
      added_at: l.addedAt.toISOString(), voided_at: l.voidedAt?.toISOString() ?? null,
    })),
  };
};

/** 201 si la mutación es nueva; 200 si la clave (o el vínculo) ya existía y se devuelve el estado actual. */
function reply({ sale, replayed }: SaleWrite, res: StatusRes): SaleResultDto {
  res.status(replayed ? 200 : 201);
  return { sale: toSale(sale), replayed };
}

const keyOf = (raw: string | undefined) => idempotencyKeySchema.parse(raw);

@Controller()
@UseFilters(PosErrorFilter)
@RequireModule('pos')
export class SalesController {
  constructor(
    @Inject(ListSales) private readonly listSales: ListSales,
    @Inject(GetSale) private readonly getSale: GetSale,
    @Inject(OpenSale) private readonly openSale: OpenSale,
    @Inject(AddSaleLine) private readonly addLine: AddSaleLine,
    @Inject(VoidSaleLine) private readonly voidLine: VoidSaleLine,
    @Inject(CompleteSale) private readonly completeSale: CompleteSale,
    @Inject(VoidSale) private readonly voidSale: VoidSale,
    @Inject(OpenLinkedSale) private readonly openLinked: OpenLinkedSale,
  ) {}

  @Get(P.sales)
  @RequirePermission('pos.sales.read')
  async sales(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() query: unknown): Promise<SaleDto[]> {
    const q = saleQuerySchema.parse(query);
    const after = q.cursor ? (parseSaleCursor(q.cursor) ?? undefined) : undefined;
    return (await this.listSales.execute({ ...contextOf(actor, locationId), status: q.status, limit: q.limit, after })).map(toSale);
  }

  @Get(P.sale)
  @RequirePermission('pos.sales.read')
  async sale(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('saleId') saleId: string): Promise<SaleDto> {
    return toSale(await this.getSale.execute({ ...contextOf(actor, locationId), saleId: idOf(saleId) }));
  }

  @Post(P.sales)
  @RequirePermission('pos.sales.operate')
  async open(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: StatusRes,
  ): Promise<SaleResultDto> {
    return reply(await this.openSale.execute({ ...contextOf(actor, locationId), idempotencyKey: keyOf(key) }), res);
  }

  @Post(P.saleLines)
  @RequirePermission('pos.sales.operate')
  async addSaleLine(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('saleId') saleId: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<SaleResultDto> {
    const idempotencyKey = keyOf(key);
    const dto = addSaleLineSchema.parse(body);
    return reply(await this.addLine.execute({
      ...contextOf(actor, locationId), saleId: idOf(saleId), sellableItemId: dto.sellable_item_id, quantity: dto.quantity, idempotencyKey,
    }), res);
  }

  @Post(P.saleLineVoid)
  @RequirePermission('pos.sales.operate')
  async voidSaleLine(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('saleId') saleId: string, @Param('lineId') lineId: string,
    @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<SaleResultDto> {
    const idempotencyKey = keyOf(key);
    return reply(await this.voidLine.execute({ ...contextOf(actor, locationId), saleId: idOf(saleId), lineId: idOf(lineId), idempotencyKey }), res);
  }

  @Post(P.saleComplete)
  @RequirePermission('pos.sales.operate')
  async complete(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('saleId') saleId: string,
    @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<SaleResultDto> {
    const idempotencyKey = keyOf(key);
    const dto = completeSaleSchema.parse(body);
    return reply(await this.completeSale.execute({
      ...contextOf(actor, locationId), saleId: idOf(saleId), paymentMethod: dto.payment_method, idempotencyKey,
    }), res);
  }

  @Post(P.saleVoid)
  @RequirePermission('pos.sales.void')
  async void(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('saleId') saleId: string,
    @Headers('idempotency-key') key: string | undefined, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<SaleResultDto> {
    const idempotencyKey = keyOf(key);
    return reply(await this.voidSale.execute({ ...contextOf(actor, locationId), saleId: idOf(saleId), idempotencyKey }), res);
  }

  @Post(P.links)
  @RequirePermission('pos.sales.operate')
  async link(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown, @Res({ passthrough: true }) res: StatusRes,
  ): Promise<SaleResultDto> {
    const idempotencyKey = keyOf(key);
    const dto = openLinkedSaleSchema.parse(body);
    return reply(await this.openLinked.execute({
      ...contextOf(actor, locationId), provider: dto.provider, resourceType: dto.resource_type, resourceId: dto.resource_id, idempotencyKey,
    }), res);
  }
}
