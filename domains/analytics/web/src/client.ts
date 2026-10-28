import { apiErrorSchema } from '@modivara/core-contracts';
import {
  ANALYTICS_API_PATHS as P, inventoryMetricsSchema, serviceCallMetricsSchema,
  type InventoryMetrics, type ServiceCallMetrics,
} from '@modivara/analytics-contracts';

export const API_BASE = '/api/v1';

/** Estados de UI tipados; los textos los decide la pantalla (diseño pendiente). */
export type ErrorState = 'forbidden' | 'not_found' | 'validation' | 'unauthorized' | 'network' | 'invalid_response' | 'unknown';

/** Error de la API: se decide por `code`/`state`, nunca por el texto. */
export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string, readonly body?: unknown) {
    super(message ?? code);
    this.name = 'ApiRequestError';
  }
}
export class InvalidResponseError extends Error {
  constructor(readonly path: string) {
    super(`Respuesta inválida del servidor en ${path}`);
    this.name = 'InvalidResponseError';
  }
}
export class NetworkError extends Error {
  constructor() { super('network_error'); this.name = 'NetworkError'; }
}

export function toErrorState(e: unknown): ErrorState {
  if (e instanceof NetworkError) return 'network';
  if (e instanceof InvalidResponseError) return 'invalid_response';
  if (!(e instanceof ApiRequestError)) return 'unknown';
  switch (e.status) {
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 400: case 422: return 'validation';
    default: return 'unknown';
  }
}

/** Sustituye `:param` codificando cada valor (un id con `/` o `..` no puede alterar la ruta). */
export function buildPath(template: string, params: Record<string, string>): string {
  return template.replace(/:(\w+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Falta el parámetro de ruta ${k}`);
    return encodeURIComponent(v);
  });
}

type Parser<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

async function get<T>(path: string, schema: Parser<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { credentials: 'include', headers: { accept: 'application/json' } });
  } catch {
    throw new NetworkError();
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw err.success ? new ApiRequestError(res.status, err.data.code, err.data.message, body) : new ApiRequestError(res.status, 'unknown_error', undefined, body);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidResponseError(path);
  return parsed.data;
}

/** Parámetros de consulta en snake_case como la API (los arma `toMetricsQuery`); el servidor los valida y responde 400 si no cuadran. */
export type MetricsParams = Record<string, string | undefined>;
const qs = (query: MetricsParams): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') q.set(k, String(v));
  return `?${q}`;
};

export const analyticsApi = {
  serviceCallMetrics: (l: string, query: MetricsParams): Promise<ServiceCallMetrics> =>
    get(buildPath(P.serviceCallMetrics, { locationId: l }) + qs(query), serviceCallMetricsSchema),
  inventoryMetrics: (l: string, query: MetricsParams): Promise<InventoryMetrics> =>
    get(buildPath(P.inventoryMetrics, { locationId: l }) + qs(query), inventoryMetricsSchema),
};
