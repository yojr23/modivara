import {
  HOSPITALITY_API_PATHS as P, deviceSchema, deviceStatusSchema, gatewayCreatedSchema, gatewaySchema,
  tableSchema, unknownDeviceSchema, zoneSchema,
  type DeviceDto, type DeviceStatusDto, type GatewayCreatedDto, type GatewayDto, type TableDto,
  type UnknownDeviceDto, type ZoneDto,
} from '@modivara/hospitality-contracts';

export const API_BASE = '/api/v1';

/** Estados de UI tipados; los textos los decide la pantalla (F2-13). */
export type ErrorState = 'forbidden' | 'conflict' | 'not_found' | 'validation' | 'unauthorized' | 'network' | 'invalid_response' | 'unknown';

/** Error de la API: se decide por `code`/`state`, nunca por el texto. */
export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
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

// OPEN: depender de core-contracts (apiErrorSchema) en vez de duplicar este esquema.
const apiErrorSchema: Parser<{ code: string; message?: string }> = {
  safeParse: (d) => {
    const o = d as { code?: unknown; message?: unknown } | null;
    return o && typeof o === 'object' && typeof o.code === 'string'
      ? { success: true, data: { code: o.code, ...(typeof o.message === 'string' ? { message: o.message } : {}) } }
      : { success: false };
  },
};

/** Traduce cualquier error a un estado de UI. 409 cubre duplicados y conflictos de estado. */
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

/** Sustituye `:param` codificando cada valor (un id con `/` o `..` no puede alterar la ruta). */
export function buildPath(template: string, params: Record<string, string>): string {
  return template.replace(/:(\w+)/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Falta el parámetro de ruta ${k}`);
    return encodeURIComponent(v);
  });
}

type Parser<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

export async function request<T>(path: string, schema: Parser<T> | null, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      ...init,
      credentials: 'include',
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), accept: 'application/json' },
    });
  } catch {
    throw new NetworkError();
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw err.success ? new ApiRequestError(res.status, err.data.code, err.data.message) : new ApiRequestError(res.status, 'unknown_error');
  }
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new InvalidResponseError(path);
  return parsed.data;
}

const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const list = <T>(item: Parser<T>): Parser<T[]> => ({
  safeParse: (d) => {
    if (!Array.isArray(d)) return { success: false };
    const out: T[] = [];
    for (const x of d) { const r = item.safeParse(x); if (!r.success) return { success: false }; out.push(r.data); }
    return { success: true, data: out };
  },
});

export type ZoneInput = { name: string; position?: number };
export type TableInput = { label: string; zone_id?: string | null; position?: number };

// OPEN: método de actualización (PATCH) y cuerpo de las respuestas de desactivar/asignar no están en el contrato; se ignoran.
export const hospitalityApi = {
  listZones: (l: string): Promise<ZoneDto[]> => request(buildPath(P.zones, { locationId: l }), list(zoneSchema)),
  createZone: (l: string, input: ZoneInput): Promise<ZoneDto> => request(buildPath(P.zones, { locationId: l }), zoneSchema, send('POST', input)),
  updateZone: (l: string, zoneId: string, input: Partial<ZoneInput>): Promise<ZoneDto> =>
    request(buildPath(P.zone, { locationId: l, zoneId }), zoneSchema, send('PATCH', input)),
  deactivateZone: (l: string, zoneId: string): Promise<void> => request(buildPath(P.zoneDeactivate, { locationId: l, zoneId }), null, send('POST')),

  listTables: (l: string): Promise<TableDto[]> => request(buildPath(P.tables, { locationId: l }), list(tableSchema)),
  createTable: (l: string, input: TableInput): Promise<TableDto> => request(buildPath(P.tables, { locationId: l }), tableSchema, send('POST', input)),
  updateTable: (l: string, tableId: string, input: Partial<TableInput>): Promise<TableDto> =>
    request(buildPath(P.table, { locationId: l, tableId }), tableSchema, send('PATCH', input)),
  deactivateTable: (l: string, tableId: string): Promise<void> => request(buildPath(P.tableDeactivate, { locationId: l, tableId }), null, send('POST')),

  deviceStatus: (l: string): Promise<DeviceStatusDto> => request(buildPath(P.deviceStatus, { locationId: l }), deviceStatusSchema),

  platform: {
    listGateways: (l: string): Promise<GatewayDto[]> => request(buildPath(P.platformGateways, { locationId: l }), list(gatewaySchema)),
    createGateway: (l: string, input: { name: string }): Promise<GatewayCreatedDto> =>
      request(buildPath(P.platformGateways, { locationId: l }), gatewayCreatedSchema, send('POST', input)),
    listDevices: (l: string): Promise<DeviceDto[]> => request(buildPath(P.platformDevices, { locationId: l }), list(deviceSchema)),
    createDevice: (l: string, input: { code: string; model?: string }): Promise<DeviceDto> =>
      request(buildPath(P.platformDevices, { locationId: l }), deviceSchema, send('POST', input)),
    listUnknownDevices: (l: string): Promise<UnknownDeviceDto[]> => request(buildPath(P.platformUnknownDevices, { locationId: l }), list(unknownDeviceSchema)),
    assignDevice: (l: string, deviceId: string, tableId: string): Promise<void> =>
      request(buildPath(P.platformAssignDevice, { locationId: l, deviceId }), null, send('POST', { table_id: tableId })),
    unassignDevice: (l: string, deviceId: string): Promise<void> =>
      request(buildPath(P.platformUnassignDevice, { locationId: l, deviceId }), null, send('POST')),
  },
};
