import type { StockBalance } from '../../domain/stock-balance.js';
import type { RegisterMovementInput, StockMovement } from '../../domain/stock-movement.js';

export interface RecordedMovement {
  movement: StockMovement;
  /** true si la idempotency_key ya existía: se devolvió el movimiento original sin aplicar nada. */
  replayed: boolean;
}

/**
 * Escritura del libro de stock. `record` es atómico: en UNA transacción
 *  1. si (organización, idempotencyKey) ya existe, devuelve ese movimiento (`replayed`);
 *  2. toma el saldo (lo crea en 0 si falta) con bloqueo y llama `StockMovement.register(balance, input)`
 *     — que rechaza el saldo negativo y valida motivo/dirección;
 *  3. guarda saldo + movimiento + eventos de `movement.pullEvents()` en el outbox.
 * Si algo falla, no queda nada a medias.
 */
export interface StockLedger {
  record(input: RegisterMovementInput): Promise<RecordedMovement>;
}

export interface BalanceQuery {
  organizationId: string;
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
