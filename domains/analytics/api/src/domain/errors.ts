export class AnalyticsDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Un evento trae un negocio/local distinto al del fact ya proyectado para el mismo agregado. */
export class TenantMismatchError extends AnalyticsDomainError {}
