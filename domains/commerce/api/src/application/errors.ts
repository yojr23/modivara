import { DomainError } from '../domain/errors.js';

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
}
/** Violaría una restricción de unicidad entre filas activas (nombre, SKU…). */
export class ConflictError extends DomainError {
  readonly code = 'conflict';
}
/** El local no existe, está inactivo o es de otro negocio. */
export class LocationUnavailableError extends DomainError {
  readonly code = 'location_unavailable';
}
