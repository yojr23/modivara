import { DomainError } from '@modivara/core-contracts';
import type { ServiceCall } from './service-calls/service-call.js';

// Errores comunes: los mismos de core-contracts, para que el borde HTTP traduzca igual en los 4 dominios.
export { ConflictError, DomainError, LocationUnavailableError, NotFoundError, ValidationError } from '@modivara/core-contracts';

/** Violación de unicidad entre filas activas (nombre de zona, etiqueta de mesa, código de botón). */
export class DuplicateError extends DomainError {
  readonly code = 'duplicate';
  constructor(readonly entity: string) {
    super(`${entity} already exists`);
  }
}

export class InvalidTransitionError extends DomainError {
  readonly code = 'invalid_transition';
  constructor(
    readonly from: string,
    readonly action: string,
  ) {
    super(`Cannot ${action} a call that is ${from}`);
  }
}

export class InvalidStateError extends DomainError {
  readonly code = 'invalid_state';
}

export class DeviceAlreadyAssignedError extends DomainError {
  readonly code = 'device_already_assigned';
  constructor(readonly tableId: string) {
    super(`Device is already assigned to table ${tableId}`);
  }
}

export class TableInUseError extends DomainError {
  readonly code = 'table_in_use';
  constructor() {
    super('Table still has devices assigned');
  }
}

/** Otro usuario o señal cambió la solicitud antes de guardar: el borde responde 409 con el estado actual. */
export class ConcurrencyConflictError extends DomainError {
  readonly code = 'concurrency_conflict';
  constructor(readonly current: ServiceCall | null) {
    super('The service call was modified concurrently');
  }
}
