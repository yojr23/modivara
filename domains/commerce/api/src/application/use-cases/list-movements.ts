import type { CoreAccessPort } from '@modivara/core-contracts';
import type { StockMovement } from '../../domain/stock-movement.js';
import type { BalanceQuery, StockQueries } from '../ports/stock-ledger.port.js';
import { requireLocation } from './shared.js';

// OPEN: paginación del historial (cursor vs offset) sin decidir; por ahora solo un límite.
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class ListMovements {
  constructor(private readonly queries: StockQueries, private readonly core: CoreAccessPort) {}

  async execute(query: BalanceQuery & { limit?: number }): Promise<StockMovement[]> {
    await requireLocation(this.core, query.organizationId, query.locationId);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    return this.queries.listMovements({ ...query, limit });
  }
}
