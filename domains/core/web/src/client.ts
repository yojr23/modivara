import {
  CORE_API_PATHS, apiErrorSchema, loginResponseSchema, meResponseSchema, membershipResponseSchema, userResponseSchema, usersResponseSchema,
  type CreateUserRequest, type LoginRequest, type LoginResponse, type MeResponse, type MembershipResponse,
  type ResetPasswordRequest, type SetLocationRolesRequest, type UserResponse, type UsersResponse,
} from '@modivara/core-contracts';

export const API_BASE = '/api/v1';

/** Error de la API: se decide por `code` (estable), nunca por el texto. */
export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'ApiRequestError';
  }
}

/** La respuesta no cumple el contrato (backend desalineado o proxy intermedio). */
export class InvalidResponseError extends Error {
  constructor(readonly path: string) {
    super(`Respuesta inválida del servidor en ${path}`);
    this.name = 'InvalidResponseError';
  }
}

/** Estado de UI tipado: 403 sin permiso, 409 usuario duplicado, 400/422 validación (p. ej. contraseña débil). */
export type ErrorState = 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'validation' | 'unknown';
export function toErrorState(e: unknown): ErrorState {
  if (!(e instanceof ApiRequestError)) return 'unknown';
  switch (e.status) {
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 400: case 422: return 'validation';
    default: return 'unknown';
  }
}

/** Sustituye `:param` codificando cada valor. */
const path = (template: string, params: Record<string, string>) =>
  template.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
const post = (body?: unknown): RequestInit => ({ method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

type Parser<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

async function request<T>(path: string, schema: Parser<T> | null, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...init,
    credentials: 'include', // la cookie de sesión es HttpOnly: solo el navegador la envía
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), accept: 'application/json' },
  });
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw err.success
      ? new ApiRequestError(res.status, err.data.code, err.data.message)
      : new ApiRequestError(res.status, 'unknown_error');
  }
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidResponseError(path);
  return parsed.data;
}

export const coreApi = {
  me: (): Promise<MeResponse> => request(CORE_API_PATHS.me, meResponseSchema),
  login: (input: LoginRequest): Promise<LoginResponse> =>
    request(CORE_API_PATHS.login, loginResponseSchema, { method: 'POST', body: JSON.stringify(input) }),
  logout: (): Promise<void> => request(CORE_API_PATHS.logout, null, { method: 'POST' }),
};

export const usersApi = {
  list: async (): Promise<UserResponse[]> => (await request<UsersResponse>(CORE_API_PATHS.users, usersResponseSchema)).users,
  create: (input: CreateUserRequest): Promise<UserResponse> => request(CORE_API_PATHS.users, userResponseSchema, post(input)),
  resetPassword: (userId: string, input: ResetPasswordRequest): Promise<void> =>
    request(path(CORE_API_PATHS.userPasswordReset, { userId }), null, post(input)),
  deactivate: (userId: string): Promise<void> => request(path(CORE_API_PATHS.userDeactivate, { userId }), null, post()),
  revokeSessions: (userId: string): Promise<void> => request(path(CORE_API_PATHS.userRevokeSessions, { userId }), null, post()),
  setLocationRoles: (userId: string, locationId: string, input: SetLocationRolesRequest): Promise<MembershipResponse> =>
    request(path(CORE_API_PATHS.userLocationRoles, { userId, locationId }), membershipResponseSchema, {
      method: 'PUT', body: JSON.stringify(input),
    }),
};
