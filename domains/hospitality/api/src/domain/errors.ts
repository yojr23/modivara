/** Base de los errores de dominio: el borde HTTP los traduce por `code`, nunca por mensaje. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'validation';
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  constructor(readonly entity: string) {
    super(`${entity} not found`);
  }
}

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

export class LocationUnavailableError extends DomainError {
  readonly code = 'location_unavailable';
  constructor(readonly locationId: string) {
    super(`Location ${locationId} does not exist, is inactive or belongs to another organization`);
  }
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
