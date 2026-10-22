import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { type ApiError } from '@modivara/core-contracts';
import type { HttpResponse } from './http.js';

/** Mensaje único de autenticación fallida (también para cuenta bloqueada): no distingue usuario inexistente de contraseña errónea. */
export const GENERIC_AUTH_MESSAGE = 'Credenciales inválidas';

/** 429 del límite por IP del login. */
export class TooManyRequestsError extends Error {
  readonly code = 'too_many_requests';
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests');
  }
}

// `location_unavailable` → 404 para no revelar si el local existe, está inactivo o es de otro negocio.
const STATUS_BY_CODE: Record<string, number> = {
  validation: 400,
  weak_password: 400,
  invalid_credentials: 401,
  session_invalid: 401,
  permission_denied: 403,
  module_disabled: 403,
  not_found: 404,
  location_unavailable: 404,
  conflict: 409,
  too_many_requests: 429,
};

const GENERIC_CODES = new Set(['invalid_credentials', 'session_invalid']);

/** Los esquemas de contrato (Zod) lanzan `ZodError`; core-api no depende de zod, se reconoce por forma. */
const isZodError = (e: unknown): e is { issues: Array<{ path: PropertyKey[]; message: string }> } =>
  e instanceof Error && e.name === 'ZodError' && Array.isArray((e as { issues?: unknown }).issues);

const clientErrorStatus = (e: unknown): number | null => {
  if (typeof e !== 'object' || e === null) return null;
  const { status, statusCode } = e as { status?: unknown; statusCode?: unknown };
  const value = [status, statusCode].find((v) => typeof v === 'number' && Number.isInteger(v) && v >= 400 && v < 500);
  return (value as number | undefined) ?? null;
};

/** Traduce `DomainError.code` (y errores de validación) a HTTP con el cuerpo `apiErrorSchema`. Registrar globalmente en el host. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponse>();
    const { status, body } = this.translate(exception);
    if (exception instanceof TooManyRequestsError) res.setHeader('Retry-After', exception.retryAfterSeconds);
    res.status(status).json(body);
  }

  private translate(e: unknown): { status: number; body: ApiError } {
    if (isZodError(e)) {
      return { status: 400, body: { code: 'validation', message: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } };
    }
    if (e instanceof HttpException) {
      return { status: e.getStatus(), body: { code: `http_${e.getStatus()}`, message: e.message } };
    }
    // Errores de librerías HTTP (p. ej. 413 `payload too large` de body-parser) llevan `status`/`statusCode` 4xx.
    const httpStatus = clientErrorStatus(e);
    if (httpStatus) return { status: httpStatus, body: { code: `http_${httpStatus}`, ...(e instanceof Error && { message: e.message }) } };
    const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
    if (e instanceof Error && typeof code === 'string' && code in STATUS_BY_CODE) {
      return { status: STATUS_BY_CODE[code]!, body: { code, message: GENERIC_CODES.has(code) ? GENERIC_AUTH_MESSAGE : e.message } };
    }
    this.logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return { status: 500, body: { code: 'internal' } };
  }
}
