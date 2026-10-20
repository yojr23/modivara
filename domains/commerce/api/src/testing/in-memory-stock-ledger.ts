import type {
  BalanceQuery,
  MovementQuery,
  RecordedMovement,
  StockLedger,
  StockQueries,
} from '../application/ports/stock-ledger.port.js';
import type { DomainEvent } from '@modivara/core-contracts';
import { StockBalance } from '../domain/stock-balance.js';
import { type RegisterMovementInput, StockMovement } from '../domain/stock-movement.js';

/**
 * Doble del ledger con las mismas reglas que el adaptador real: idempotencia por (negocio, key),
 * saldo sin negativos y todo-o-nada (se trabaja sobre una copia del saldo y se confirma al final).
 */
export class InMemoryStockLedger implements StockLedger, StockQueries {
  private readonly balances = new Map<string, StockBalance>();
  private readonly movements: StockMovement[] = [];
  private readonly byKey = new Map<string, StockMovement>();
  /** Equivale a la tabla outbox_events. */
  readonly outbox: DomainEvent[] = [];

  async record(input: RegisterMovementInput): Promise<RecordedMovement> {
    const orgId = input.stockLocation.organizationId;
    const existing = this.byKey.get(`${orgId}:${input.idempotencyKey}`);
    if (existing) return { movement: existing, replayed: true };

    const key = `${input.stockLocation.id}:${input.product.id}`;
    const current = this.balances.get(key);
    const work = current
      ? StockBalance.restore(current.toProps())
      : StockBalance.zero(
          {
            stockLocationId: input.stockLocation.id,
            productId: input.product.id,
            organizationId: orgId,
            locationId: input.stockLocation.locationId,
          },
          input.occurredAt,
        );

    const movement = StockMovement.register(work, input); // si lanza, no se confirmó nada

    this.balances.set(key, work);
    this.movements.push(movement);
    this.byKey.set(`${orgId}:${input.idempotencyKey}`, movement);
    this.outbox.push(...movement.pullEvents());
    return { movement, replayed: false };
  }

  async listBalances(q: BalanceQuery): Promise<StockBalance[]> {
    return [...this.balances.values()]
      .filter((b) => b.organizationId === q.organizationId && b.locationId === q.locationId)
      .filter((b) => !q.stockLocationId || b.stockLocationId === q.stockLocationId)
      .filter((b) => !q.productId || b.productId === q.productId)
      .map((b) => StockBalance.restore(b.toProps()));
  }

  async listMovements(q: MovementQuery): Promise<StockMovement[]> {
    return this.movements
      .filter((m) => m.organizationId === q.organizationId && m.locationId === q.locationId)
      .filter((m) => !q.stockLocationId || m.stockLocationId === q.stockLocationId)
      .filter((m) => !q.productId || m.productId === q.productId)
      .reverse() // inserción = orden cronológico
      .slice(0, q.limit);
  }
}
