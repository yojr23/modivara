/**
 * Base de los errores de dominio de los 4 dominios. El borde HTTP traduce por `code` (snake_case estable),
 * nunca por mensaje. Los mensajes son internos y en inglés.
 */
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

/** No existe o no pertenece al negocio/local del actor: nunca se distingue (no revelar existencia). */
export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  readonly entity: string;
  constructor(entity: string) {
    super(`${entity} not found`);
    this.entity = entity;
  }
}

/** Violaría una restricción de unicidad entre filas activas. */
export class ConflictError extends DomainError {
  readonly code = 'conflict';
}

/** El local no existe, está inactivo (o su negocio) o es de otro negocio. */
export class LocationUnavailableError extends DomainError {
  readonly code = 'location_unavailable';
  constructor() {
    super('location unavailable');
  }
}
