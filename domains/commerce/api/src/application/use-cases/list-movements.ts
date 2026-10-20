import type { StockMovement } from '../../domain/stock-movement.js';
import type { BalanceQuery, StockQueries } from '../ports/stock-ledger.port.js';

// OPEN: paginación del historial (cursor vs offset) sin decidir; por ahora solo un límite.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListMovements {
  constructor(private readonly queries: StockQueries) {}

  execute(query: BalanceQuery & { limit?: number }): Promise<StockMovement[]> {
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    return this.queries.listMovements({ ...query, limit });
  }
}
