import { InsufficientStockError } from './errors.js';
import { Quantity } from './quantity.js';

export interface StockBalanceProps {
  stockLocationId: string;
  productId: string;
  organizationId: string;
  locationId: string;
  quantity: Quantity;
  updatedAt: Date;
}

/** Saldo por (lugar de stock, producto). */
export class StockBalance {
  private constructor(private props: StockBalanceProps) {}

  static zero(key: Omit<StockBalanceProps, 'quantity' | 'updatedAt'>, now: Date): StockBalance {
    return new StockBalance({ ...key, quantity: Quantity.zero(), updatedAt: now });
  }

  static restore(props: StockBalanceProps): StockBalance {
    return new StockBalance({ ...props });
  }

  get stockLocationId() { return this.props.stockLocationId; }
  get productId() { return this.props.productId; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get quantity() { return this.props.quantity; }
  get updatedAt() { return this.props.updatedAt; }

  /** Aplica un delta con signo. Rechaza dejar el saldo negativo. */
  apply(delta: Quantity, now: Date): void {
    const next = this.props.quantity.plus(delta);
    // ponytail: sin negativos mientras se escala (TECH-001 §16.8); si cambia, quitar esta guarda y el CHECK.
    if (next.isNegative()) {
      throw new InsufficientStockError(`Insufficient stock: ${this.props.quantity} on hand, ${delta.negate()} requested`);
    }
    this.props.quantity = next;
    this.props.updatedAt = now;
  }

  toProps(): StockBalanceProps {
    return { ...this.props };
  }
}
