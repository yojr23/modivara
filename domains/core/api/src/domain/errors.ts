/** Base de los errores de dominio; `code` es estable para que el borde HTTP los traduzca. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidValueError extends DomainError {
  readonly code = 'invalid_value';
}
export class WeakPasswordError extends DomainError {
  readonly code = 'weak_password';
}
/** Genérico a propósito: no revela si el usuario, el negocio o la contraseña fallaron. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'invalid_credentials';
  constructor() {
    super('Invalid credentials');
  }
}
export class AccountLockedError extends DomainError {
  readonly code = 'account_locked';
  constructor(readonly retryAt: Date) {
    super('Account temporarily locked');
  }
}
export class SessionInvalidError extends DomainError {
  readonly code = 'session_invalid';
  constructor() {
    super('Session is missing, expired or revoked');
  }
}
export class PermissionDeniedError extends DomainError {
  readonly code = 'permission_denied';
}
/** Se usa también cuando el recurso es de otro negocio, para no revelar que existe. */
export class NotFoundError extends DomainError {
  readonly code = 'not_found';
}
export class ConflictError extends DomainError {
  readonly code = 'conflict';
}
