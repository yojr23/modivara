import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { inventoryMetricsSchema, serviceCallMetricsSchema } from '@modivara/analytics-contracts';
import {
  ApiRequestError, InvalidResponseError, NetworkError, RANGE_PRESETS, analyticsApi, metricsErrorState, toErrorState, toMetricsQuery,
  useInventoryMetrics, useServiceCallMetrics,
} from './index.js';

const L = '11111111-1111-4111-8111-111111111111';
const stats = { count: 0, average_seconds: null, median_seconds: null };
const calls = {
  timezone: 'America/Bogota', from: '2026-10-19T05:00:00.000Z', to: '2026-10-20T05:00:00.000Z', group_by: 'day',
  totals: { calls: 0, pending: 0, in_progress: 0, completed: 0, repeated_presses: 0, calls_with_repeated_presses: 0 },
  time_to_acknowledge: stats, time_to_complete: stats, by_table: [], by_zone: [], by_period: [],
};
const inventory = { timezone: 'America/Bogota', from: calls.from, to: calls.to, group_by: 'hour', by_direction: [], by_reason: [], by_period: [], balances: [] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const stub = (res: Response) => {
  const f = vi.fn().mockImplementation(async () => res.clone());
  vi.stubGlobal('fetch', f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

it('cada atajo (salvo custom) envía solo el atajo', () => {
  for (const preset of RANGE_PRESETS.filter((p) => p !== 'custom')) {
    expect(toMetricsQuery({ preset })).toEqual({ ok: true, query: { range: preset } });
  }
  // from/to se ignoran si no es custom: el servidor los rechazaría
  expect(toMetricsQuery({ preset: 'today', from: '2026-10-01', to: '2026-10-02' })).toEqual({ ok: true, query: { range: 'today' } });
});

it('custom exige from y to ordenados', () => {
  expect(toMetricsQuery({ preset: 'custom' })).toEqual({ ok: false, error: 'custom_requires_dates' });
  expect(toMetricsQuery({ preset: 'custom', from: '2026-10-01' })).toEqual({ ok: false, error: 'custom_requires_dates' });
  expect(toMetricsQuery({ preset: 'custom', from: '2026-10-02', to: '2026-10-01' })).toEqual({ ok: false, error: 'custom_range_reversed' });
  expect(toMetricsQuery({ preset: 'custom', from: '2026-10-01', to: '2026-10-02' })).toEqual({
    ok: true, query: { range: 'custom', from: '2026-10-01', to: '2026-10-02' },
  });
});

it('group_by y filtros se agregan y los vacíos se omiten', () => {
  expect(toMetricsQuery({ preset: 'last_7_days', groupBy: 'hour', filters: { zone_id: 'z1', table_id: undefined, product_id: '' } })).toEqual({
    ok: true, query: { range: 'last_7_days', group_by: 'hour', zone_id: 'z1' },
  });
});

it('el cliente arma la URL con la query, valida la respuesta y envía credenciales', async () => {
  const f = stub(json(calls));
  const q = toMetricsQuery({ preset: 'last_30_days', groupBy: 'day', filters: { zone_id: 'z1' } });
  if (!q.ok) throw new Error('unreachable');
  expect(serviceCallMetricsSchema.parse(await analyticsApi.serviceCallMetrics('a/b', q.query))).toEqual(calls);
  expect(f).toHaveBeenCalledWith('/api/v1/locations/a%2Fb/metrics/service-calls?range=last_30_days&group_by=day&zone_id=z1', expect.objectContaining({ credentials: 'include' }));

  const g = stub(json(inventory));
  expect(inventoryMetricsSchema.parse(await analyticsApi.inventoryMetrics(L, { range: 'today' }))).toEqual(inventory);
  expect(g.mock.calls[0]![0]).toBe(`/api/v1/locations/${L}/metrics/inventory?range=today`);
});

it('403, 404 y 400 de la API se traducen a estados tipados', async () => {
  for (const [status, state] of [[403, 'forbidden'], [404, 'not_found'], [400, 'validation'], [401, 'unauthorized'], [500, 'unknown']] as const) {
    stub(json({ code: 'x', message: 'm' }, status));
    const e = await analyticsApi.serviceCallMetrics(L, { range: 'today' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiRequestError);
    expect(e.code).toBe('x');
    expect(toErrorState(e)).toBe(state);
  }
  expect(metricsErrorState(null)).toBeUndefined();
  expect(metricsErrorState(new ApiRequestError(403, 'permission_denied'))).toBe('forbidden');
});

it('red y respuesta inválida también se tipifican', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
  const n = await analyticsApi.inventoryMetrics(L, { range: 'today' }).catch((e) => e);
  expect(n).toBeInstanceOf(NetworkError);
  expect(toErrorState(n)).toBe('network');
  stub(json({ nope: true }));
  const bad = await analyticsApi.inventoryMetrics(L, { range: 'today' }).catch((e) => e);
  expect(bad).toBeInstanceOf(InvalidResponseError);
  expect(toErrorState(bad)).toBe('invalid_response');
});

it('los hooks entregan los datos y exponen el error sin reintentar', async () => {
  stub(json(calls));
  const ok = renderHook(() => useServiceCallMetrics(L, { range: 'today' }), { wrapper });
  await waitFor(() => expect(ok.result.current.data).toEqual(calls));

  const f = stub(json({ code: 'permission_denied' }, 403));
  const denied = renderHook(() => useInventoryMetrics(L, { range: 'today' }), { wrapper });
  await waitFor(() => expect(denied.result.current.isError).toBe(true));
  expect(metricsErrorState(denied.result.current.error)).toBe('forbidden');
  expect(f).toHaveBeenCalledTimes(1);
});
