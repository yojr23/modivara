import { apiErrorSchema } from '@modivara/core-contracts';
import {
  IDEMPOTENCY_KEY_HEADER, POS_API_PATHS as P, POS_ERROR_CODES, posSettingsSchema, saleResultSchema, saleSchema, sellableItemSchema,
  type AddSaleLineDto, type CompleteSaleDto, type CreateSellableItemDto, type OpenLinkedSaleDto, type PosSettingsDto, type SaleDto,
  type SaleQueryDto, type SaleResultDto, type SellableItemDto, type UpdateSellableItemDto,
} from '@modivara/pos-contracts';

// Cliente propio de POS: duplica el `request` mínimo de los otros `*-web` porque un dominio no puede importarlos (ADR-002 D1).

export const API_BASE = '/api/v1';

/** Estados de UI tipados; los textos los decide la pantalla. */
export type ErrorState = 'forbidden' | 'conflict' | 'not_found' | 'validation' | 'unauthorized' | 'network' | 'invalid_response' | 'unknown';
/** Los `code` de negocio de POS que la UI explica con un mensaje propio (todos 409/400 en la API). */
const POS_STATES = [
  POS_ERROR_CODES.saleNotOpen, POS_ERROR_CODES.emptySale, POS_ERROR_CODES.currencyMismatch, POS_ERROR_CODES.currencyLocked, POS_ERROR_CODES.invalidQuantity,
  POS_ERROR_CODES.inactiveEntity, POS_ERROR_CODES.idempotencyKeyReused,
] as const;
export type PosErrorState = ErrorState | (typeof POS_STATES)[number];

/** Error de la API: se decide por `code`/`status`, nunca por el texto. `status` y `name` los lee el portal (`describeError`). */
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

/** Como `toErrorState`, pero separa los errores de negocio de la venta por su `code`. */
export function toPosErrorState(e: unknown): PosErrorState {
  if (e instanceof ApiRequestError && (POS_STATES as readonly string[]).includes(e.code)) return e.code as PosErrorState;
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

async function request<T>(path: string, schema: Parser<T> | null, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
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

/** Una clave por intento de usuario: reintentar el MISMO intento reutiliza la clave y no duplica la operación. */
export const newIdempotencyKey = (): string => crypto.randomUUID();
const idem = (key: string) => ({ [IDEMPOTENCY_KEY_HEADER]: key });

export type SaleFilters = Partial<Pick<SaleQueryDto, 'status' | 'limit' | 'cursor'>>;
const saleQuery = (f: SaleFilters): string => {
  const q = new URLSearchParams();
  if (f.status) q.set('status', f.status);
  if (f.limit) q.set('limit', String(f.limit));
  if (f.cursor) q.set('cursor', f.cursor);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const posApi = {
  listItems: (l: string): Promise<SellableItemDto[]> => request(buildPath(P.items, { locationId: l }), list(sellableItemSchema)),
  createItem: (l: string, input: CreateSellableItemDto): Promise<SellableItemDto> =>
    request(buildPath(P.items, { locationId: l }), sellableItemSchema, send('POST', input)),
  updateItem: (l: string, itemId: string, input: UpdateSellableItemDto): Promise<SellableItemDto> =>
    request(buildPath(P.item, { locationId: l, itemId }), sellableItemSchema, send('PATCH', input)),
  deactivateItem: (l: string, itemId: string): Promise<void> => request(buildPath(P.itemDeactivate, { locationId: l, itemId }), null, send('POST')),

  getSettings: (l: string): Promise<PosSettingsDto> => request(buildPath(P.settings, { locationId: l }), posSettingsSchema),
  updateSettings: (l: string, input: PosSettingsDto): Promise<PosSettingsDto> => request(buildPath(P.settings, { locationId: l }), posSettingsSchema, send('PUT', input)),

  listSales: (l: string, f: SaleFilters = {}): Promise<SaleDto[]> => request(buildPath(P.sales, { locationId: l }) + saleQuery(f), list(saleSchema)),
  getSale: (l: string, saleId: string): Promise<SaleDto> => request(buildPath(P.sale, { locationId: l, saleId }), saleSchema),

  // Mutaciones de la venta: `Idempotency-Key` obligatorio (POS-18); la moneda la pone el local.
  openSale: (l: string, key: string = newIdempotencyKey()): Promise<SaleResultDto> =>
    request(buildPath(P.sales, { locationId: l }), saleResultSchema, send('POST', undefined, idem(key))),
  addLine: (l: string, saleId: string, input: AddSaleLineDto, key: string = newIdempotencyKey()): Promise<SaleResultDto> =>
    request(buildPath(P.saleLines, { locationId: l, saleId }), saleResultSchema, send('POST', input, idem(key))),
  voidLine: (l: string, saleId: string, lineId: string, key: string = newIdempotencyKey()): Promise<SaleResultDto> =>
    request(buildPath(P.saleLineVoid, { locationId: l, saleId, lineId }), saleResultSchema, send('POST', undefined, idem(key))),
  completeSale: (l: string, saleId: string, input: CompleteSaleDto, key: string = newIdempotencyKey()): Promise<SaleResultDto> =>
    request(buildPath(P.saleComplete, { locationId: l, saleId }), saleResultSchema, send('POST', input, idem(key))),
  voidSale: (l: string, saleId: string, key: string = newIdempotencyKey()): Promise<SaleResultDto> =>
    request(buildPath(P.saleVoid, { locationId: l, saleId }), saleResultSchema, send('POST', undefined, idem(key))),
  openLinkedSale: (l: string, input: OpenLinkedSaleDto, key: string = newIdempotencyKey()): Promise<SaleResultDto> =>
    request(buildPath(P.links, { locationId: l }), saleResultSchema, send('POST', input, idem(key))),
};
