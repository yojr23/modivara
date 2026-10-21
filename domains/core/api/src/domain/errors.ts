import { DomainError } from '@modivara/core-contracts';

// Los errores comunes (ValidationError, NotFoundError, ConflictError) viven en core-contracts.

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
export class SessionInvalidError extends DomainError {
  readonly code = 'session_invalid';
  constructor() {
    super('Session is missing, expired or revoked');
  }
}
export class PermissionDeniedError extends DomainError {
  readonly code = 'permission_denied';
}

/** El negocio no tiene contratado (o tiene apagado) el módulo de la ruta. */
export class ModuleDisabledError extends DomainError {
  readonly code = 'module_disabled';
}
