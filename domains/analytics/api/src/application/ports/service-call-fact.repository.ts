import type { DateRange, ServiceCallFact } from '../../domain/index.js';

export interface ServiceCallFactQuery {
  organizationId: string;
  locationId: string;
  /** Periodo sobre `created_at`. */
  range: DateRange;
  zoneId?: string | undefined;
  tableId?: string | undefined;
}

export interface ServiceCallFactRepository {
  findById(serviceCallId: string): Promise<ServiceCallFact | null>;
  /** Inserta o reemplaza por `serviceCallId`. */
  save(fact: ServiceCallFact): Promise<void>;
  findCreatedBetween(query: ServiceCallFactQuery): Promise<ServiceCallFact[]>;
  /** Solo para reconstrucción de proyecciones. */
  clear(): Promise<void>;
}
