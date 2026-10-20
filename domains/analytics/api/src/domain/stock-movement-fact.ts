import type { MovementDirection, StockEventPayload } from '@modivara/commerce-contracts';
import { parseMilli } from './decimal.js';

export interface StockMovementFactProps {
  movementId: string;
  organizationId: string;
  locationId: string;
  stockLocationId: string;
  productId: string;
  productName: string;
  direction: MovementDirection;
  reasonId: string;
  reasonName: string;
  /** Strings decimales exactos (NUMERIC(12,3)). */
  delta: string;
  balanceAfter: string;
  occurredAt: Date;
}

/** Movimiento de inventario proyectado desde received/issued/adjusted. Inmutable: reaplicar el evento no cambia nada. */
export class StockMovementFact {
  private constructor(private readonly props: StockMovementFactProps) {}

  static create(input: {
    organizationId: string;
    locationId: string;
    direction: MovementDirection;
    payload: StockEventPayload;
  }): StockMovementFact {
    const { payload: p } = input;
    parseMilli(p.delta); // valida formato
    parseMilli(p.balance_after);
    return new StockMovementFact({
      movementId: p.movement_id,
      organizationId: input.organizationId,
      locationId: input.locationId,
      stockLocationId: p.stock_location_id,
      productId: p.product_id,
      productName: p.product_name,
      direction: input.direction,
      reasonId: p.reason_id,
      reasonName: p.reason_name,
      delta: p.delta,
      balanceAfter: p.balance_after,
      occurredAt: new Date(p.occurred_at),
    });
  }

  static restore(props: StockMovementFactProps): StockMovementFact {
    return new StockMovementFact({ ...props });
  }

  get snapshot(): Readonly<StockMovementFactProps> {
    return this.props;
  }
  get movementId(): string {
    return this.props.movementId;
  }
  get deltaMilli(): bigint {
    return parseMilli(this.props.delta);
  }
}
