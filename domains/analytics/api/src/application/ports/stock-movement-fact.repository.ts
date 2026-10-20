import type { DateRange, StockMovementFact } from '../../domain/index.js';

export interface StockMovementFactQuery {
  organizationId: string;
  locationId: string;
  productId?: string | undefined;
  stockLocationId?: string | undefined;
}

export interface StockMovementFactRepository {
  /** Inserta o reemplaza por `movementId`. */
  save(fact: StockMovementFact): Promise<void>;
  /** Movimientos con `occurred_at` en el rango. */
  findOccurredBetween(query: StockMovementFactQuery & { range: DateRange }): Promise<StockMovementFact[]>;
  /** Último movimiento (por occurred_at) de cada (lugar, producto), sin límite de fecha. */
  findLatestPerPlaceAndProduct(query: StockMovementFactQuery): Promise<StockMovementFact[]>;
  /** Solo para reconstrucción de proyecciones. */
  clear(): Promise<void>;
}
