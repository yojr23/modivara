import type { StockLocation } from '../../domain/stock-location.js';

export interface StockLocationRepository {
  save(stockLocation: StockLocation): Promise<void>;
  findById(query: { id: string; organizationId: string; locationId: string }): Promise<StockLocation | null>;
  findActiveDefault(query: { organizationId: string; locationId: string }): Promise<StockLocation | null>;
  findActiveByName(query: { organizationId: string; locationId: string; name: string }): Promise<StockLocation | null>;
}
