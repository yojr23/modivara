import type { StockLocation } from '../../domain/stock-location.js';

export interface StockLocationRepository {
  save(stockLocation: StockLocation): Promise<void>;
  findById(organizationId: string, id: string): Promise<StockLocation | null>;
  findActiveDefault(organizationId: string, locationId: string): Promise<StockLocation | null>;
  findActiveByName(organizationId: string, locationId: string, name: string): Promise<StockLocation | null>;
}
