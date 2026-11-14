import { DomainError } from '@modivara/core-contracts';

export { ConflictError, DomainError, LocationUnavailableError, NotFoundError } from '@modivara/core-contracts';

export class InvalidValueError extends DomainError {
  readonly code = 'invalid_value';
}
export class InvalidQuantityError extends DomainError {
  readonly code = 'invalid_quantity';
}
export class InactiveEntityError extends DomainError {
  readonly code = 'inactive_entity';
}
/** La venta ya está cerrada o anulada: no admite cambios. */
export class SaleNotOpenError extends DomainError {
  readonly code = 'sale_not_open';
}
/** Una venta sin líneas vigentes no se cierra. */
export class EmptySaleError extends DomainError {
  readonly code = 'empty_sale';
}
export class CurrencyMismatchError extends DomainError {
  readonly code = 'currency_mismatch';
}
