import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiRequestError, RealtimeProvider, callErrorState, hospitalityKeys, useAcknowledgeCall, useActiveCalls, useConnectionStatus, useGatewaysStatus,
  type RealtimeSocket,
} from '../index.js';

const L = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const T = '33333333-3333-4333-8333-333333333333';
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const call = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n), table_id: T, table_display_name: 'Mesa 3', call_type: 'attention', status: 'pending', press_count: 1,
  created_at: '2026-01-01T10:00:00Z', last_press_at: '2026-01-01T10:00:00Z',
  acknowledged_at: null, acknowledged_by: null, completed_at: null, completed_by: null, ...over,
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

class FakeSocket implements RealtimeSocket {
  handlers = new Map<string, (...a: any[]) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  emitted: unknown[][] = [];
  ackWith: unknown = { ok: true };
  disconnected = false;
  on(e: string, f: (...a: any[]) => void) { this.handlers.set(e, f); } // eslint-disable-line @typescript-eslint/no-explicit-any
  emit(e: string, ...args: unknown[]) {
    this.emitted.push([e, ...args]);
    const ack = args.at(-1);
    if (typeof ack === 'function') ack(this.ackWith);
  }
  disconnect() { this.disconnected = true; }
  fire(e: string, ...a: unknown[]) { act(() => { this.handlers.get(e)?.(...a); }); }
}

let rest: ReturnType<typeof vi.fn>;
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const sock = new FakeSocket();
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><RealtimeProvider locationId={L} socketFactory={() => sock}>{children}</RealtimeProvider></QueryClientProvider>
  );
  return { sock, qc, wrapper };
}
const stubRest = (items: () => unknown[]) => {
  rest = vi.fn().mockImplementation(async () => json({ items: items(), next_cursor: null }));
  vi.stubGlobal('fetch', rest);
};

it('tras cortar y restaurar la conexión relee por REST y la lista converge; el estado cambia', async () => {
  let server = [call(1)];
  stubRest(() => server);
  const { sock, wrapper } = setup();
  const { result } = renderHook(() => ({ calls: useActiveCalls(L), status: useConnectionStatus() }), { wrapper });
  expect(result.current.status).toBe('connecting');
  await waitFor(() => expect(result.current.calls.data).toHaveLength(1));
  sock.fire('connect');
  expect(result.current.status).toBe('connected');
  expect(sock.emitted[0]).toEqual(['location.subscribe', { location_id: L }, expect.any(Function)]);
  expect(rest).toHaveBeenCalledTimes(1); // primera conexión: sin relectura extra

  sock.fire('disconnect');
  expect(result.current.status).toBe('disconnected');
  server = [call(1, { status: 'in_progress' }), call(2)]; // cambió mientras estaba caído
  sock.fire('connect');
  expect(sock.emitted).toHaveLength(2); // re-suscripción
  await waitFor(() => expect(result.current.calls.data).toHaveLength(2));
  expect(rest).toHaveBeenCalledTimes(2);
  expect(result.current.calls.data?.[0]?.status).toBe('in_progress');
});

it('service_call.changed agrega, actualiza y quita completados; inválidos se ignoran', async () => {
  stubRest(() => [call(1)]);
  const { sock, wrapper } = setup();
  const { result } = renderHook(() => useActiveCalls(L), { wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  sock.fire('service_call.changed', call(2));
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  sock.fire('service_call.changed', call(1, { press_count: 3 }));
  await waitFor(() => expect(result.current.data?.find((c) => c.id === id(1))?.press_count).toBe(3));
  sock.fire('service_call.changed', { ...call(3), status: 'bogus' });
  sock.fire('service_call.changed', 'basura');
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  sock.fire('service_call.changed', call(1, { status: 'completed' }));
  await waitFor(() => expect(result.current.data?.map((c) => c.id)).toEqual([id(2)]));
});

it('gateways.status de otro local o inválido se ignora; ack negativo deja desconectado', async () => {
  stubRest(() => []);
  const { sock, wrapper } = setup();
  const { result } = renderHook(() => ({ g: useGatewaysStatus(), s: useConnectionStatus() }), { wrapper });
  sock.fire('gateways.status', { location_id: OTHER, connectivity: 'all_connected' });
  sock.fire('gateways.status', { location_id: L, connectivity: 'nope' });
  expect(result.current.g).toBeUndefined();
  sock.fire('gateways.status', { location_id: L, connectivity: 'some_disconnected' });
  expect(result.current.g).toBe('some_disconnected');
  sock.ackWith = { ok: false, code: 'forbidden' };
  sock.fire('connect');
  expect(result.current.s).toBe('disconnected');
});

it('al desmontar se cierra el socket', () => {
  stubRest(() => []);
  const { sock, wrapper } = setup();
  renderHook(() => useConnectionStatus(), { wrapper }).unmount();
  expect(sock.disconnected).toBe(true);
});

it('reconocer: éxito actualiza el caché; 409 con llamado vigente se traduce a estado tipado', async () => {
  stubRest(() => [call(1)]);
  const { qc, wrapper } = setup();
  const { result } = renderHook(() => ({ calls: useActiveCalls(L), ack: useAcknowledgeCall(L) }), { wrapper });
  await waitFor(() => expect(result.current.calls.data).toHaveLength(1));

  const current = call(1, { status: 'in_progress', acknowledged_at: '2026-01-01T10:01:00Z', acknowledged_by: id(7) });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'call_already_acknowledged', message: 'x', current }, 409)));
  let err: unknown;
  await act(async () => { err = await result.current.ack.mutateAsync(id(1)).catch((e) => e); });
  expect(err).toBeInstanceOf(ApiRequestError);
  expect(callErrorState(err)).toEqual({ state: 'conflict', current });
  expect(qc.getQueryData<{ status: string }[]>(['hospitality', L, 'service-calls', 'active'])?.[0]?.status).toBe('in_progress');

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'conflict' }, 409)));
  await act(async () => { err = await result.current.ack.mutateAsync(id(1)).catch((e) => e); });
  expect(callErrorState(err)).toEqual({ state: 'conflict' });
  expect(callErrorState(null)).toBeUndefined();
  expect(hospitalityKeys.zones(L)).toBeDefined();
});
