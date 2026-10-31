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

  /** Igual que `execute`, con el nombre de quien registró (una consulta a core por página); null si no se resuelve. */
  async withActorNames(query: BalanceQuery & { limit?: number }): Promise<{ movement: StockMovement; actorName: string | null }[]> {
    const movements = await this.execute(query);
    const names = await this.core.userDisplayNames({ organizationId: query.organizationId, userIds: [...new Set(movements.map((m) => m.actorUserId))] });
    return movements.map((movement) => ({ movement, actorName: names.get(movement.actorUserId) ?? null }));
  }
}
