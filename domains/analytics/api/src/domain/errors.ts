import { DomainError } from '@modivara/core-contracts';

/** An event carries an organization/location different from the fact already projected for the same aggregate. */
export class TenantMismatchError extends DomainError {
  readonly code = 'tenant_mismatch';
}

/** The event does not match its contract (envelope or payload). */
export class InvalidEventError extends DomainError {
  readonly code = 'invalid_event';
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

/** The event depends on another that has not arrived yet; retryable, the event must not be marked as processed. */
export class EventOutOfOrderError extends DomainError {
  readonly code = 'out_of_order';
}
