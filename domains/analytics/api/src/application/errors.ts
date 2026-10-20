import { AnalyticsDomainError } from '../domain/errors.js';

export class InvalidEventError extends AnalyticsDomainError {
  readonly code = 'invalid_event';
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

/** El local no existe o no pertenece al negocio del solicitante (no se distingue, para no filtrar existencia). */
export class LocationUnavailableError extends AnalyticsDomainError {
  readonly code = 'location_unavailable';
  constructor(locationId: string) {
    super(`Local no encontrado: ${locationId}`);
  }
}
