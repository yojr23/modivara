import { HttpException, Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, LocationUnavailableError, NotFoundError, ValidationError, apiErrorSchema, loginRequestSchema } from '@modivara/core-contracts';
import { AccountLockedError, InvalidCredentialsError, ModuleDisabledError, PermissionDeniedError, SessionInvalidError, WeakPasswordError } from '../domain/index.js';
import { DomainExceptionFilter, GENERIC_AUTH_MESSAGE, TooManyRequestsError } from './domain-exception.filter.js';

function run(error: unknown) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  new DomainExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => res }) } as never);
  return { status: res.status.mock.calls[0]![0] as number, body: res.json.mock.calls[0]![0] as unknown, res };
}

describe('DomainExceptionFilter', () => {
  it.each([
    [new NotFoundError('User'), 404, 'not_found'],
    [new ConflictError('x'), 409, 'conflict'],
    [new ValidationError('x'), 400, 'validation'],
    [new WeakPasswordError('x'), 400, 'weak_password'],
    [new LocationUnavailableError(), 404, 'location_unavailable'],
    [new InvalidCredentialsError(), 401, 'invalid_credentials'],
    [new AccountLockedError(new Date()), 423, 'account_locked'],
    [new SessionInvalidError(), 401, 'session_invalid'],
    [new PermissionDeniedError('x'), 403, 'permission_denied'],
    [new ModuleDisabledError('x'), 403, 'module_disabled'],
    [new TooManyRequestsError(5), 429, 'too_many_requests'],
  ])('%s -> %i %s con cuerpo apiErrorSchema', (error, status, code) => {
    const out = run(error);
    expect(out.status).toBe(status);
    expect(apiErrorSchema.parse(out.body).code).toBe(code);
  });

  it('credenciales inválidas y bloqueo comparten el mensaje genérico', () => {
    expect((run(new InvalidCredentialsError()).body as { message: string }).message).toBe(GENERIC_AUTH_MESSAGE);
    expect((run(new AccountLockedError(new Date())).body as { message: string }).message).toBe(GENERIC_AUTH_MESSAGE);
  });

  it('ZodError -> 400 validation; HttpException conserva su estado; lo desconocido -> 500 sin detalles', () => {
    let zod: unknown;
    try { loginRequestSchema.parse({}); } catch (e) { zod = e; }
    expect(run(zod)).toMatchObject({ status: 400, body: { code: 'validation' } });
    expect(run(new HttpException('x', 418)).status).toBe(418);
    expect(run(new Error('secreto de base de datos'))).toMatchObject({ status: 500, body: { code: 'internal' } });
  });

  it('429 incluye Retry-After', () => {
    expect(run(new TooManyRequestsError(7)).res.setHeader).toHaveBeenCalledWith('Retry-After', 7);
  });
});
