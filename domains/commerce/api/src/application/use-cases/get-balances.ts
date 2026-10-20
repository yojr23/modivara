import type { StockBalance } from '../../domain/stock-balance.js';
import type { BalanceQuery, StockQueries } from '../ports/stock-ledger.port.js';

export class GetBalances {
  constructor(private readonly queries: StockQueries) {}

  execute(query: BalanceQuery): Promise<StockBalance[]> {
    return this.queries.listBalances(query);
  }
}
