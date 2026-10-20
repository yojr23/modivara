import type { DomainEvent } from '../domain/domain-event.js';

/** Único punto donde el evento interno (camelCase) pasa al sobre snake_case de contracts. El payload ya es snake_case. */
export const toEventEnvelope = (e: DomainEvent) => ({
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
});
