import {
  type MovementDirection,
  NOTE_MAX_LENGTH,
  STOCK_EVENT_TYPES,
  type StockEventPayload,
} from '@modivara/commerce-contracts';
import type { DomainEvent } from './domain-event.js';
import {
  InactiveEntityError,
  InvalidMovementError,
  OrganizationMismatchError,
  ReasonDirectionMismatchError,
} from './errors.js';
import { optionalText } from './name.js';
import type { MovementReason } from './movement-reason.js';
import type { Product } from './product.js';
import { Quantity } from './quantity.js';
import type { StockBalance } from './stock-balance.js';
import type { StockLocation } from './stock-location.js';

/**
 * Lo que se pide. `in`/`out` llevan magnitud > 0 (el signo lo pone la dirección);
 * `adjust` lleva delta con signo; `count` lleva lo contado y el delta se calcula contra el saldo.
 */
export type MovementChange =
  | { kind: 'in' | 'out'; quantity: Quantity }
  | { kind: 'adjust'; delta: Quantity }
  | { kind: 'count'; counted: Quantity };

export interface StockMovementProps {
  id: string;
  organizationId: string;
  locationId: string;
  stockLocationId: string;
  productId: string;
  direction: MovementDirection;
  reasonId: string;
  delta: Quantity;
  balanceAfter: Quantity;
  note: string | null;
  actorUserId: string;
  occurredAt: Date;
  idempotencyKey: string;
}

export interface RegisterMovementInput {
  id: string;
  eventId: string;
  product: Product;
  stockLocation: StockLocation;
  reason: MovementReason;
  change: MovementChange;
  note?: string | null;
  actorUserId: string;
  idempotencyKey: string;
  occurredAt: Date;
}

/** Fila del libro de movimientos: inmutable una vez creada. */
export class StockMovement {
  private pending: DomainEvent<StockEventPayload>[] = [];

  private constructor(private readonly props: StockMovementProps) {}

  /**
   * Única puerta para registrar un movimiento. Valida todo y, solo si es válido,
   * aplica el delta al saldo (que rechaza el negativo). Los adaptadores la llaman dentro de su transacción.
   */
  static register(balance: StockBalance, input: RegisterMovementInput): StockMovement {
    const { product, stockLocation, reason } = input;
    const orgId = stockLocation.organizationId;
    if (
      product.organizationId !== orgId ||
      reason.organizationId !== orgId ||
      balance.organizationId !== orgId ||
      balance.stockLocationId !== stockLocation.id ||
      balance.productId !== product.id
    ) {
      throw new OrganizationMismatchError('Producto, lugar de stock, motivo y saldo deben ser del mismo negocio y coincidir');
    }
    if (!product.isActive) throw new InactiveEntityError('El producto está desactivado');
    stockLocation.assertActive();
    if (!reason.isActive) throw new InactiveEntityError('El motivo está desactivado');

    const { direction, delta } = StockMovement.resolve(input.change, balance.quantity);
    if (reason.direction !== direction) {
      throw new ReasonDirectionMismatchError(`El motivo "${reason.name}" es de dirección ${reason.direction}, no ${direction}`);
    }
    const note = optionalText('La nota', input.note, NOTE_MAX_LENGTH);

    balance.apply(delta, input.occurredAt);

    const movement = new StockMovement({
      id: input.id,
      organizationId: orgId,
      locationId: stockLocation.locationId,
      stockLocationId: stockLocation.id,
      productId: product.id,
      direction,
      reasonId: reason.id,
      delta,
      balanceAfter: balance.quantity,
      note,
      actorUserId: input.actorUserId,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey,
    });
    movement.pending.push({
      eventId: input.eventId,
      eventType: STOCK_EVENT_TYPES[direction],
      eventVersion: 1,
      occurredAt: input.occurredAt,
      organizationId: orgId,
      locationId: stockLocation.locationId,
      aggregateId: input.id,
      // OPEN: ¿de dónde sale correlation_id? Provisional: el id del movimiento (no hay trazas de petición aún).
      correlationId: input.id,
      causationId: null,
      payload: {
        movement_id: input.id,
        stock_location_id: stockLocation.id,
        product_id: product.id,
        product_name: product.name,
        reason_id: reason.id,
        reason_name: reason.name,
        delta: delta.toString(),
        balance_after: balance.quantity.toString(),
        occurred_at: input.occurredAt.toISOString(),
        actor_user_id: input.actorUserId,
      },
    });
    return movement;
  }

  static restore(props: StockMovementProps): StockMovement {
    return new StockMovement({ ...props });
  }

  private static resolve(change: MovementChange, current: Quantity): { direction: MovementDirection; delta: Quantity } {
    switch (change.kind) {
      case 'in':
      case 'out': {
        if (!change.quantity.isPositive()) throw new InvalidMovementError('La cantidad de entrada/salida debe ser mayor que cero');
        return change.kind === 'in'
          ? { direction: 'in', delta: change.quantity }
          : { direction: 'out', delta: change.quantity.negate() };
      }
      case 'adjust':
        if (change.delta.isZero()) throw new InvalidMovementError('Un ajuste no puede ser cero');
        return { direction: 'adjust', delta: change.delta };
      case 'count': {
        if (change.counted.isNegative()) throw new InvalidMovementError('Lo contado no puede ser negativo');
        // OPEN: contado == saldo → se rechaza (el CHECK exige delta ≠ 0) en vez de ser un no-op silencioso.
        const delta = change.counted.minus(current);
        if (delta.isZero()) throw new InvalidMovementError('El conteo coincide con el saldo: no hay nada que ajustar');
        return { direction: 'adjust', delta };
      }
    }
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get stockLocationId() { return this.props.stockLocationId; }
  get productId() { return this.props.productId; }
  get direction() { return this.props.direction; }
  get reasonId() { return this.props.reasonId; }
  get delta() { return this.props.delta; }
  get balanceAfter() { return this.props.balanceAfter; }
  get note() { return this.props.note; }
  get actorUserId() { return this.props.actorUserId; }
  get occurredAt() { return this.props.occurredAt; }
  get idempotencyKey() { return this.props.idempotencyKey; }

  /** Entrega y vacía los eventos pendientes para que el repositorio los lleve al outbox. */
  pullEvents(): DomainEvent<StockEventPayload>[] {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  toProps(): StockMovementProps {
    return { ...this.props };
  }
}
