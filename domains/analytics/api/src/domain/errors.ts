/** Base de los errores de dominio: `code` estable para que presentation los traduzca a HTTP. */
export abstract class AnalyticsDomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Un evento trae un negocio/local distinto al del fact ya proyectado para el mismo agregado. */
export class TenantMismatchError extends AnalyticsDomainError {
  readonly code = 'tenant_mismatch';
}
