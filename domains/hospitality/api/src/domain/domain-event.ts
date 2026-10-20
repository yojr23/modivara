/** Evento de dominio pendiente de publicar; el repositorio lo escribe en el outbox en la misma transacción. */
export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  eventId: string;
  eventType: TType;
  eventVersion: number;
  occurredAt: Date;
  organizationId: string;
  locationId: string;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  /** snake_case, tal como lo valida el contrato del evento. */
  payload: TPayload;
}
