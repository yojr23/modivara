import {
  MONEY_SCALE,
  PAYMENT_METHODS,
  type PaymentMethod,
  QUANTITY_SCALE,
  SALE_COMPLETED,
  type SaleCompletedPayload,
  type SaleStatus,
  type Unit,
  formatScaled,
  multiplyMoney,
} from '@modivara/pos-contracts';
import { AggregateRoot } from '@modivara/core-contracts';
import { CurrencyMismatchError, EmptySaleError, InvalidValueError, NotFoundError, SaleNotOpenError } from './errors.js';
import type { SellableItem } from './sellable-item.js';
import { parseQuantity, requireCurrency } from './values.js';

/** Línea con snapshot del artículo al momento de venderlo: cambios posteriores del catálogo no la alteran. */
export interface SaleLine {
  id: string;
  sellableItemId: string;
  skuSnapshot: string | null;
  nameSnapshot: string;
  unitSnapshot: Unit;
  /** Centésimas. */
  unitPriceSnapshot: bigint;
  /** Milésimas. */
  quantity: bigint;
  addedAt: Date;
  addedBy: string;
  voidedAt: Date | null;
  voidedBy: string | null;
}

export interface SaleProps {
  id: string;
  organizationId: string;
  locationId: string;
  currency: string;
  status: SaleStatus;
  lines: SaleLine[];
  paymentMethod: PaymentMethod | null;
  openedAt: Date;
  openedBy: string;
  /** Cierre o anulación, según `status`. */
  closedAt: Date | null;
  closedBy: string | null;
}

/**
 * Venta genérica: no sabe de rubros ni de contextos externos. Abrir no exige contexto ni referencia externa;
 * un vínculo con otro producto vive fuera de este agregado (PLAN-POS-001 §3).
 */
export class Sale extends AggregateRoot {
  private constructor(private readonly props: SaleProps) {
    super();
  }

  static open(input: { id: string; organizationId: string; locationId: string; currency: string; actorUserId: string; now: Date }): Sale {
    return new Sale({
      id: input.id,
      organizationId: input.organizationId,
      locationId: input.locationId,
      currency: requireCurrency(input.currency),
      status: 'open',
      lines: [],
      paymentMethod: null,
      openedAt: input.now,
      openedBy: input.actorUserId,
      closedAt: null,
      closedBy: null,
    });
  }

  static restore(props: SaleProps): Sale {
    return new Sale({ ...props, lines: props.lines.map((l) => ({ ...l })) });
  }

  addLine(input: { lineId: string; item: SellableItem; quantity: string; actorUserId: string; now: Date }): SaleLine {
    this.assertOpen();
    const { item } = input;
    if (item.organizationId !== this.props.organizationId || item.locationId !== this.props.locationId) {
      throw new NotFoundError('Sellable item');
    }
    item.assertActive();
    if (item.currency !== this.props.currency) {
      throw new CurrencyMismatchError(`Item currency ${item.currency} differs from sale currency ${this.props.currency}`);
    }
    const line: SaleLine = {
      id: input.lineId,
      sellableItemId: item.id,
      skuSnapshot: item.sku,
      nameSnapshot: item.name,
      unitSnapshot: item.unit,
      unitPriceSnapshot: item.price,
      quantity: parseQuantity(input.quantity, item.unit),
      addedAt: input.now,
      addedBy: input.actorUserId,
      voidedAt: null,
      voidedBy: null,
    };
    this.props.lines.push(line);
    return { ...line };
  }

  /** Anular deja la línea (auditoría) y la saca del total. */
  voidLine(lineId: string, actorUserId: string, now: Date): void {
    this.assertOpen();
    const line = this.props.lines.find((l) => l.id === lineId && l.voidedAt === null);
    if (!line) throw new NotFoundError('Sale line');
    line.voidedAt = now;
    line.voidedBy = actorUserId;
  }

  /** Cierra con un cobro declarado (no procesado) y registra `pos.sale.completed.v1` para el outbox. */
  complete(input: { eventId: string; paymentMethod: string; actorUserId: string; now: Date }): void {
    this.assertOpen();
    if (!(PAYMENT_METHODS as readonly string[]).includes(input.paymentMethod)) {
      throw new InvalidValueError(`Invalid payment method: ${input.paymentMethod}`);
    }
    const lines = this.activeLines;
    if (lines.length === 0) throw new EmptySaleError('A sale without lines cannot be completed');
    const p = this.props;
    p.status = 'completed';
    p.paymentMethod = input.paymentMethod as PaymentMethod;
    p.closedAt = input.now;
    p.closedBy = input.actorUserId;
    const payload: SaleCompletedPayload = {
      sale_id: p.id,
      currency: p.currency,
      total: formatScaled(this.total, MONEY_SCALE),
      payment_method: p.paymentMethod,
      completed_at: input.now.toISOString(),
      actor_user_id: input.actorUserId,
      lines: lines.map((l) => ({
        line_id: l.id,
        sellable_item_id: l.sellableItemId,
        sku: l.skuSnapshot,
        name: l.nameSnapshot,
        unit: l.unitSnapshot,
        unit_price: formatScaled(l.unitPriceSnapshot, MONEY_SCALE),
        quantity: formatScaled(l.quantity, QUANTITY_SCALE),
        line_total: formatScaled(multiplyMoney(l.unitPriceSnapshot, l.quantity), MONEY_SCALE),
      })),
    };
    this.record({
      eventId: input.eventId,
      eventType: SALE_COMPLETED,
      eventVersion: 1,
      occurredAt: input.now,
      organizationId: p.organizationId,
      locationId: p.locationId,
      aggregateId: p.id,
      // OPEN: origen de correlation_id; provisional el id de la venta, como commerce.
      correlationId: p.id,
      causationId: null,
      payload,
    });
  }

  /** Anula una venta abierta. Una venta cerrada no se anula aquí: devoluciones quedan fuera del primer entregable. */
  void(actorUserId: string, now: Date): void {
    this.assertOpen();
    this.props.status = 'voided';
    this.props.closedAt = now;
    this.props.closedBy = actorUserId;
  }

  /** Suma de líneas vigentes, cada una redondeada a centésimas. */
  get total(): bigint {
    return this.activeLines.reduce((sum, l) => sum + multiplyMoney(l.unitPriceSnapshot, l.quantity), 0n);
  }

  get activeLines(): SaleLine[] {
    return this.props.lines.filter((l) => l.voidedAt === null).map((l) => ({ ...l }));
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get currency() { return this.props.currency; }
  get status() { return this.props.status; }
  get paymentMethod() { return this.props.paymentMethod; }

  toProps(): SaleProps {
    return { ...this.props, lines: this.props.lines.map((l) => ({ ...l })) };
  }

  private assertOpen(): void {
    if (this.props.status !== 'open') throw new SaleNotOpenError(`Sale is ${this.props.status}`);
  }
}
