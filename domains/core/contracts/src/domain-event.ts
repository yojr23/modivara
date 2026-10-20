import type { EventEnvelope } from './events.js';

/** Evento de dominio pendiente; el repositorio lo escribe en el outbox en la misma transacción (DATA-001 §6). */
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
  /** Ya en snake_case, tal como lo valida el contrato del evento. */
  payload: TPayload;
}

/** Agregado que acumula eventos pendientes. Único patrón en los 4 dominios: `record` dentro, `pullEvents` al guardar. */
export abstract class AggregateRoot {
  #pending: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#pending.push(event);
  }

  /** Devuelve y vacía los eventos pendientes; lo llama el repositorio al persistir. */
  pullEvents(): DomainEvent[] {
    const events = this.#pending;
    this.#pending = [];
    return events;
  }
}

/** Único mapeo del evento interno (camelCase) al sobre de integración (snake_case). */
export function toEventEnvelope<T extends DomainEvent>(e: T): EventEnvelope & { payload: T['payload'] } {
  return {
    event_id: e.eventId,
    event_type: e.eventType,
    event_version: e.eventVersion,
    occurred_at: e.occurredAt.toISOString(),
    organization_id: e.organizationId,
    location_id: e.locationId,
    aggregate_id: e.aggregateId,
    correlation_id: e.correlationId,
    causation_id: e.causationId,
    payload: e.payload,
  };
}
