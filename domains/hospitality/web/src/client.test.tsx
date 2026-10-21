import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiRequestError, InvalidResponseError, NetworkError, hospitalityApi, toErrorState,
  useCreateTable, useDeactivateZone, useZones, platform,
} from './index.js';

const L = '11111111-1111-4111-8111-111111111111';
const Z = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';
const zone = { id: Z, name: 'Terraza', position: 0 };
const table = { id: T, label: 'Mesa 3', zone_id: Z, zone_name: 'Terraza', display_name: 'Terraza · Mesa 3', position: 0 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const stub = (res: Response | (() => Response)) => {
  const f = vi.fn().mockImplementation(async () => (typeof res === 'function' ? res() : res));
  vi.stubGlobal('fetch', f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

it('valida contra el contrato, envía credenciales y codifica el locationId', async () => {
  const f = stub(json([zone]));
  expect(await hospitalityApi.listZones('a/b?x#')).toEqual([zone]);
  expect(f).toHaveBeenCalledWith('/api/v1/locations/a%2Fb%3Fx%23/zones', expect.objectContaining({ credentials: 'include' }));
});

it('403 y 409 se traducen a estados tipados', async () => {
  stub(json({ code: 'forbidden' }, 403));
  expect(toErrorState(await hospitalityApi.listZones(L).catch((e) => e))).toBe('forbidden');
  stub(json({ code: 'duplicate_label' }, 409));
  const e = await hospitalityApi.createTable(L, { label: 'x' }).catch((x) => x);
  expect(e).toBeInstanceOf(ApiRequestError);
  expect(e.code).toBe('duplicate_label');
  expect(toErrorState(e)).toBe('conflict');
  expect(toErrorState(new ApiRequestError(404, 'x'))).toBe('not_found');
  expect(toErrorState(new ApiRequestError(400, 'x'))).toBe('validation');
});

it('fallo de red y respuesta inválida dan errores claros', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
  const n = await hospitalityApi.listTables(L).catch((e) => e);
  expect(n).toBeInstanceOf(NetworkError);
  expect(toErrorState(n)).toBe('network');
  stub(json([{ id: 'no-uuid' }]));
  const e = await hospitalityApi.listZones(L).catch((x) => x);
  expect(e).toBeInstanceOf(InvalidResponseError);
  expect(toErrorState(e)).toBe('invalid_response');
});

it('useZones expone los datos por local', async () => {
  stub(json([zone]));
  const { wrapper } = setup();
  const { result } = renderHook(() => useZones(L), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual([zone]));
});

it('crear mesa invalida mesas y estado de botones del local, no zonas ni otros locales', async () => {
  stub(() => json(table, 201));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useCreateTable(L), { wrapper });
  await act(() => result.current.mutateAsync({ label: 'Mesa 3' }));
  const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
  expect(keys).toEqual([['hospitality', L, 'tables'], ['hospitality', L, 'device-status']]);
});

it('desactivar zona invalida zonas y mesas', async () => {
  stub(new Response(null, { status: 204 }));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useDeactivateZone(L), { wrapper });
  await act(() => result.current.mutateAsync(Z));
  expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([['hospitality', L, 'zones'], ['hospitality', L, 'tables']]);
});

it('plataforma: asignar invalida dispositivos, desconocidos y estado; la ruta codifica ids', async () => {
  const f = stub(new Response(null, { status: 204 }));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => platform.useAssignDevice(L), { wrapper });
  await act(() => result.current.mutateAsync({ deviceId: 'd/1', tableId: T }));
  expect(f.mock.calls[0]![0]).toBe(`/api/v1/platform/locations/${L}/devices/d%2F1/assign`);
  expect(spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey)).toEqual([
    ['hospitality', L, 'platform', 'devices'], ['hospitality', L, 'platform', 'unknown-devices'], ['hospitality', L, 'device-status'],
  ]);
});
