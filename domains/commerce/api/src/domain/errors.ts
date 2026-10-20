/** Base de los errores de dominio: `code` estable para que presentation los traduzca a HTTP. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidQuantityError extends DomainError {
  readonly code = 'invalid_quantity';
}
export class QuantityOutOfRangeError extends DomainError {
  readonly code = 'quantity_out_of_range';
}
export class InvalidValueError extends DomainError {
  readonly code = 'invalid_value';
}
export class InactiveEntityError extends DomainError {
  readonly code = 'inactive_entity';
}
export class OrganizationMismatchError extends DomainError {
  readonly code = 'organization_mismatch';
}
export class InvalidMovementError extends DomainError {
  readonly code = 'invalid_movement';
}
export class ReasonDirectionMismatchError extends DomainError {
  readonly code = 'reason_direction_mismatch';
}
export class InsufficientStockError extends DomainError {
  readonly code = 'insufficient_stock';
}
