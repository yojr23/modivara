export class InvalidEventError extends Error {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'InvalidEventError';
  }
}

/** El local no existe o no pertenece al negocio del solicitante (no se distingue, para no filtrar existencia). */
export class LocationNotFoundError extends Error {
  constructor(locationId: string) {
    super(`Local no encontrado: ${locationId}`);
    this.name = 'LocationNotFoundError';
  }
}
