/** Evento pendiente dentro del agregado; el repositorio lo escribe en el outbox en la misma transacción (DATA-001 §6). */
export interface DomainEvent<P = unknown> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  organizationId: string;
  locationId: string;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  /** Ya en snake_case, tal como lo define el contrato. */
  payload: P;
}
