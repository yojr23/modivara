import {
  CORE_API_PATHS, apiErrorSchema, loginResponseSchema, meResponseSchema,
  type LoginRequest, type LoginResponse, type MeResponse,
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
