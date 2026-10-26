import { apiErrorSchema } from '@modivara/core-contracts';
import {
  COMMERCE_API_PATHS as P, COMMERCE_ERROR_CODES, IDEMPOTENCY_KEY_HEADER, balanceSchema, movementReasonSchema, movementSchema, productSchema,
  recordedMovementSchema, stockLocationSchema,
  type AdjustToCountDto, type BalanceDto, type CreateMovementReasonDto, type CreateProductDto, type CreateStockLocationDto, type MovementDto,
  type MovementReasonDto, type ProductDto, type RecordedMovementDto, type RegisterMovementDto, type StockLocationDto, type UpdateProductDto,
} from '@modivara/commerce-contracts';

export const API_BASE = '/api/v1';

/** Estados de UI tipados; los textos los decide la pantalla (F4-09). */
export type ErrorState = 'forbidden' | 'conflict' | 'not_found' | 'validation' | 'unauthorized' | 'network' | 'invalid_response' | 'unknown';
/** Los errores de saldo se distinguen del 409 genérico: la UI muestra un mensaje propio (saldo insuficiente). */
export type StockErrorState = ErrorState | 'insufficient_stock' | 'idempotency_key_reused';

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
    case 409: return 'conflict';
    case 400: case 422: return 'validation';
    default: return 'unknown';
  }
}

/** Como `toErrorState`, pero separa «saldo insuficiente» y «clave de idempotencia reutilizada» por su `code`. */
export function toStockErrorState(e: unknown): StockErrorState {
  if (e instanceof ApiRequestError) {
    if (e.code === COMMERCE_ERROR_CODES.insufficientStock) return 'insufficient_stock';
    if (e.code === COMMERCE_ERROR_CODES.idempotencyKeyReused) return 'idempotency_key_reused';
  }
  return toErrorState(e);
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

export async function request<T>(path: string, schema: Parser<T> | null, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), accept: 'application/json', ...init.headers },
    });
  } catch {
    throw new NetworkError();
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw err.success ? new ApiRequestError(res.status, err.data.code, err.data.message, body) : new ApiRequestError(res.status, 'unknown_error', undefined, body);
  }
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidResponseError(path);
  return parsed.data;
}

const send = (method: string, body?: unknown, headers?: Record<string, string>): RequestInit & { headers?: Record<string, string> } => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  ...(headers && { headers }),
});
const list = <T>(item: Parser<T>): Parser<T[]> => ({
  safeParse: (d) => {
    if (!Array.isArray(d)) return { success: false };
    const out: T[] = [];
    for (const x of d) { const r = item.safeParse(x); if (!r.success) return { success: false }; out.push(r.data); }
    return { success: true, data: out };
  },
});

/** Una clave por intento de usuario: reintentar el MISMO intento reutiliza la clave y no duplica el movimiento. */
export const newIdempotencyKey = (): string => crypto.randomUUID();

export interface StockFilters { stockLocationId?: string; productId?: string; limit?: number }
const stockQuery = (f: StockFilters): string => {
  const q = new URLSearchParams();
  if (f.stockLocationId) q.set('stock_location_id', f.stockLocationId);
  if (f.productId) q.set('product_id', f.productId);
  if (f.limit) q.set('limit', String(f.limit));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const commerceApi = {
  listProducts: (l: string): Promise<ProductDto[]> => request(buildPath(P.products, { locationId: l }), list(productSchema)),
  createProduct: (l: string, input: CreateProductDto): Promise<ProductDto> => request(buildPath(P.products, { locationId: l }), productSchema, send('POST', input)),
  updateProduct: (l: string, productId: string, input: UpdateProductDto): Promise<ProductDto> =>
    request(buildPath(P.product, { locationId: l, productId }), productSchema, send('PATCH', input)),
  deactivateProduct: (l: string, productId: string): Promise<void> => request(buildPath(P.productDeactivate, { locationId: l, productId }), null, send('POST')),

  listStockLocations: (l: string): Promise<StockLocationDto[]> => request(buildPath(P.stockLocations, { locationId: l }), list(stockLocationSchema)),
  createStockLocation: (l: string, input: CreateStockLocationDto): Promise<StockLocationDto> =>
    request(buildPath(P.stockLocations, { locationId: l }), stockLocationSchema, send('POST', input)),

  listReasons: (): Promise<MovementReasonDto[]> => request(P.reasons, list(movementReasonSchema)),
  createReason: (input: CreateMovementReasonDto): Promise<MovementReasonDto> => request(P.reasons, movementReasonSchema, send('POST', input)),
  deactivateReason: (reasonId: string): Promise<void> => request(buildPath(P.reasonDeactivate, { reasonId }), null, send('POST')),

  listBalances: (l: string, f: StockFilters = {}): Promise<BalanceDto[]> => request(buildPath(P.balances, { locationId: l }) + stockQuery(f), list(balanceSchema)),
  listMovements: (l: string, f: StockFilters = {}): Promise<MovementDto[]> => request(buildPath(P.movements, { locationId: l }) + stockQuery(f), list(movementSchema)),
  registerMovement: (l: string, input: RegisterMovementDto, idempotencyKey: string = newIdempotencyKey()): Promise<RecordedMovementDto> =>
    request(buildPath(P.movements, { locationId: l }), recordedMovementSchema, send('POST', input, { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey })),
  adjustToCount: (l: string, input: AdjustToCountDto, idempotencyKey: string = newIdempotencyKey()): Promise<RecordedMovementDto> =>
    request(buildPath(P.countAdjustments, { locationId: l }), recordedMovementSchema, send('POST', input, { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey })),
};
