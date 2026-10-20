import type { DomainEvent } from '@modivara/core-contracts';
import type {
  BalanceKey,
  BalanceQuery,
  LedgerTransaction,
  MovementQuery,
  StockLedger,
  StockQueries,
} from '../application/ports/stock-ledger.port.js';
import { StockBalance } from '../domain/stock-balance.js';
import type { StockMovement } from '../domain/stock-movement.js';

/**
 * In-memory double with the same contract as the real adapter: calls on the same balance key are
 * serialized, work happens on a copy of the balance and is committed only if `work` resolves
 * (otherwise nothing is left behind: no balance, movement or outbox event).
 */
export class InMemoryStockLedger implements StockLedger, StockQueries {
  private readonly balances = new Map<string, StockBalance>();
  private readonly movements: StockMovement[] = [];
  private readonly byKey = new Map<string, StockMovement>();
  private readonly locks = new Map<string, Promise<void>>();
  /** Equivale a la tabla outbox_events. */
  readonly outbox: DomainEvent[] = [];

  async withLockedBalance<T>(key: BalanceKey, work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    const lockKey = `${key.stockLocationId}:${key.productId}`;
    const previous = this.locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const tail = previous.then(() => new Promise<void>((resolve) => (release = resolve)));
    this.locks.set(lockKey, tail);
    await previous;
    try {
      const current = this.balances.get(lockKey);
      const balance = current ? StockBalance.restore(current.toProps()) : StockBalance.zero(key, new Date());
      let saved: StockMovement | null = null;
      const tx: LedgerTransaction = {
        balance,
        findByIdempotencyKey: async ({ organizationId, idempotencyKey }) =>
          this.byKey.get(`${organizationId}:${idempotencyKey}`) ?? null,
        save: async (movement) => {
          saved = movement;
        },
      };
      const result = await work(tx);
      if (saved) this.commit(lockKey, balance, saved);
      return result;
    } finally {
      release();
      if (this.locks.get(lockKey) === tail) this.locks.delete(lockKey);
    }
  }

  private commit(lockKey: string, balance: StockBalance, movement: StockMovement): void {
    this.balances.set(lockKey, balance);
    this.movements.push(movement);
    this.byKey.set(`${movement.organizationId}:${movement.idempotencyKey}`, movement);
    this.outbox.push(...movement.pullEvents());
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
