import { CALLS_API_PATHS as P, callConflictSchema, serviceCallPageSchema, serviceCallSchema, type ServiceCallDto, type ServiceCallPage } from '@modivara/hospitality-contracts';
import { ApiRequestError, buildPath, request } from './client.js';

export type CallHistoryQuery = {
  status?: 'active' | 'all' | ServiceCallDto['status'];
  table_id?: string; from?: string; to?: string; cursor?: string; limit?: number;
};

const qs = (q: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v));
  return p.size ? `?${p}` : '';
};
const base = (l: string) => buildPath(P.serviceCalls, { locationId: l });
const MAX_ACTIVE_PAGES = 20; // ponytail: los activos son pocos; tope defensivo contra un cursor que no termina

/** 409 al reconocer/finalizar: estado tipado + el llamado vigente si el servidor lo envía. */
export type CallConflict = { state: 'conflict'; current?: ServiceCallDto };
export function toCallConflict(e: unknown): CallConflict | undefined {
  if (!(e instanceof ApiRequestError) || e.status !== 409) return undefined;
  const c = callConflictSchema.safeParse(e.body);
  return c.success ? { state: 'conflict', current: c.data.current } : { state: 'conflict' };
}

export const callsApi = {
  async listActive(l: string): Promise<ServiceCallDto[]> {
    const items: ServiceCallDto[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_ACTIVE_PAGES; i++) {
      const page = await request(base(l) + qs({ status: 'active', limit: 200, cursor }), serviceCallPageSchema);
      items.push(...page.items);
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return items;
  },
  listHistory: (l: string, q: CallHistoryQuery = {}): Promise<ServiceCallPage> =>
    request(base(l) + qs({ status: 'all', ...q }), serviceCallPageSchema),
  // OPEN: el cuerpo de la respuesta de reconocer/finalizar se asume `ServiceCallDto` (no está en el contrato).
  acknowledge: (l: string, callId: string): Promise<ServiceCallDto> =>
    request(buildPath(P.acknowledge, { locationId: l, callId }), serviceCallSchema, { method: 'POST' }),
  complete: (l: string, callId: string): Promise<ServiceCallDto> =>
    request(buildPath(P.complete, { locationId: l, callId }), serviceCallSchema, { method: 'POST' }),
};
