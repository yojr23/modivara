import type { DomainEvent } from '@modivara/core-contracts';

/** Outbox de core (DATA-001 §6), ligado a la misma transacción que el cambio que lo origina. */
export interface OutboxAppender {
  append(event: DomainEvent): Promise<void>;
}
