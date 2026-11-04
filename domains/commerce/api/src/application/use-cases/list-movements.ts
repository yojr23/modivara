import type { CoreAccessPort } from '@modivara/core-contracts';
import type { StockMovement } from '../../domain/stock-movement.js';
import type { MovementQuery, StockQueries } from '../ports/stock-ledger.port.js';
import { requireLocation } from './shared.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type ListQuery = Omit<MovementQuery, 'limit'> & { limit?: number };

export class ListMovements {
  constructor(private readonly queries: StockQueries, private readonly core: CoreAccessPort) {}

  async execute(query: ListQuery): Promise<StockMovement[]> {
    await requireLocation(this.core, query.organizationId, query.locationId);
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    return this.queries.listMovements({ ...query, limit });
  }

  /** Igual que `execute`, con el nombre de quien registró (una consulta a core por página); null si no se resuelve. */
  async withActorNames(query: ListQuery): Promise<{ movement: StockMovement; actorName: string | null }[]> {
    const movements = await this.execute(query);
    const names = await this.core.userDisplayNames({ organizationId: query.organizationId, userIds: [...new Set(movements.map((m) => m.actorUserId))] });
    return movements.map((movement) => ({ movement, actorName: names.get(movement.actorUserId) ?? null }));
  }
}
