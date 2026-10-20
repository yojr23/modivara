import type { StockBalance } from '../../domain/stock-balance.js';
import type { StockMovement } from '../../domain/stock-movement.js';

/** Row of stock_balances that a movement locks (DATA-001 §4). */
export interface BalanceKey {
  stockLocationId: string;
  productId: string;
  organizationId: string;
  locationId: string;
}

/**
 * Work inside the ledger transaction. The adapter holds no business rules: the use case calls
 * `StockMovement.register(tx.balance, …)` once and then `tx.save`.
 */
export interface LedgerTransaction {
  /** Locked balance (zero if it did not exist). `StockMovement.register` mutates it in place. */
  readonly balance: StockBalance;
  /** Idempotency is per (business, key). */
  findByIdempotencyKey(query: { organizationId: string; idempotencyKey: string }): Promise<StockMovement | null>;
  /** Writes movement + `tx.balance` + the movement's pending events (outbox) as one unit. */
  save(movement: StockMovement): Promise<void>;
}

/**
 * Bounded transactional port. `withLockedBalance` opens a transaction, locks the balance row
 * (`INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE`) and runs `work`. If `work` resolves, it
 * commits; if it throws, it rolls back and leaves no trace. Calls on the same key are serialized.
 * Callers must keep `work` short: it only talks to `tx`.
 */
export interface StockLedger {
  withLockedBalance<T>(key: BalanceKey, work: (tx: LedgerTransaction) => Promise<T>): Promise<T>;
}

export interface BalanceQuery {
  organizationId: string;
  /** Obligatorio: las lecturas de stock son por local (DATA-001 §1). */
  locationId: string;
  stockLocationId?: string;
  productId?: string;
}

export interface MovementQuery extends BalanceQuery {
  limit: number;
}

/** Lecturas del libro (sin efectos). */
export interface StockQueries {
  listBalances(query: BalanceQuery): Promise<StockBalance[]>;
  /** Más recientes primero. */
  listMovements(query: MovementQuery): Promise<StockMovement[]>;
}
