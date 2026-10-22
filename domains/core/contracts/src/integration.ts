import type { EventEnvelope } from './events.js';

/** Evento de integración tal como sale del outbox de un dominio emisor (sobre + payload propio). */
export type IntegrationEvent = EventEnvelope & { payload: unknown };

/**
 * Lo que el poller de outbox de cada dominio emisor entrega (TECH-001 §16.2, DATA-001 §6). Entrega at-least-once:
 * el suscriptor debe ser idempotente por `event_id`. Si `handle` lanza, el poller reintenta con espera creciente.
 */
export interface IntegrationEventSubscriber {
  readonly name: string;
  handles(eventType: string): boolean;
  handle(event: IntegrationEvent): Promise<void>;
}

/** Token multi-proveedor bajo el que el host registra los suscriptores; el poller los inyecta sin conocer sus dominios. */
export const INTEGRATION_EVENT_SUBSCRIBERS = 'INTEGRATION_EVENT_SUBSCRIBERS';
