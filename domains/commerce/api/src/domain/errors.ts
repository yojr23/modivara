import { DomainError } from '@modivara/core-contracts';

export { ConflictError, DomainError, LocationUnavailableError, NotFoundError, ValidationError } from '@modivara/core-contracts';

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
/** Product, stock location, reason and balance do not share business/location. */
export class ScopeMismatchError extends DomainError {
  readonly code = 'scope_mismatch';
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
