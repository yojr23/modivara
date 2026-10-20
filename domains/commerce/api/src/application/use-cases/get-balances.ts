import type { CoreAccessPort } from '@modivara/core-contracts';
import type { StockBalance } from '../../domain/stock-balance.js';
import type { BalanceQuery, StockQueries } from '../ports/stock-ledger.port.js';
import { requireLocation } from './shared.js';

export class GetBalances {
  constructor(private readonly queries: StockQueries, private readonly core: CoreAccessPort) {}

  async execute(query: BalanceQuery): Promise<StockBalance[]> {
    await requireLocation(this.core, query.organizationId, query.locationId);
    return this.queries.listBalances(query);
  }
}
