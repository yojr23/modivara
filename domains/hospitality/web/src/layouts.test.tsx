import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiRequestError, RealtimeProvider, layoutErrorState, layoutsApi, toLayoutConflict, useLayoutDraft, useLayouts, usePublishLayout, useSaveLayoutDraft,
  type RealtimeSocket,
} from './index.js';

const L = '11111111-1111-4111-8111-111111111111';
const Z = '22222222-2222-4222-8222-222222222222';
const layout = (over: Record<string, unknown> = {}) => ({
  id: '44444444-4444-4444-8444-444444444444', zone_id: null, version: 0, status: 'draft', canvas_width: 800, canvas_height: 600,
  elements: [{ id: '55555555-5555-4555-8555-555555555555', type: 'bar', x: 1, y: 1, width: 10, height: 10, rotation: 0 }],
  revision: 1, updated_at: '2026-10-28T10:00:00Z', published_at: null, ...over,
});
const published = layout({ status: 'published', version: 1, published_at: '2026-10-28T10:00:00Z' });
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

it('useLayouts pide los publicados del local y valida el contrato', async () => {
  const f = stub(json([published]));
  const { wrapper } = setup();
  const { result } = renderHook(() => useLayouts(L), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual([published]));
  expect(f).toHaveBeenCalledWith(`/api/v1/locations/${L}/layouts`, expect.objectContaining({ credentials: 'include' }));
  stub(json([{ id: 'no' }]));
  await expect(layoutsApi.listPublished(L)).rejects.toMatchObject({ name: 'InvalidResponseError' });
});

it('useLayoutDraft: sin zona no envía zone_id y con zona sí; las claves no se mezclan', async () => {
  const f = stub(() => json({ draft: layout(), published: null }));
  const { wrapper } = setup();
  const a = renderHook(() => useLayoutDraft(L, null), { wrapper });
  const b = renderHook(() => useLayoutDraft(L, Z), { wrapper });
  await waitFor(() => expect(a.result.current.data?.draft?.revision).toBe(1));
  await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
  expect(f.mock.calls.map((c) => c[0]).sort()).toEqual([`/api/v1/locations/${L}/layouts/draft`, `/api/v1/locations/${L}/layouts/draft?zone_id=${Z}`]);
});

it('guardar envía PUT con el cuerpo y relee el borrador; publicar invalida borrador y publicados', async () => {
  const f = stub(() => json(layout({ revision: 2 })));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const body = { zone_id: null, revision: 1, canvas_width: 800, canvas_height: 600, elements: [] };
  const save = renderHook(() => useSaveLayoutDraft(L), { wrapper });
  await act(() => save.result.current.mutateAsync(body));
  expect(f).toHaveBeenCalledWith(`/api/v1/locations/${L}/layouts/draft`, expect.objectContaining({ method: 'PUT', body: JSON.stringify(body) }));
  expect(spy).toHaveBeenCalledWith({ queryKey: ['hospitality', L, 'layouts', 'draft', 'default'] });

  spy.mockClear();
  stub(json(published));
  const pub = renderHook(() => usePublishLayout(L), { wrapper });
  await act(() => pub.result.current.mutateAsync({ zone_id: Z, revision: 2 }));
  expect(spy).toHaveBeenCalledWith({ queryKey: ['hospitality', L, 'layouts', 'draft', Z] });
  expect(spy).toHaveBeenCalledWith({ queryKey: ['hospitality', L, 'layouts', 'published'] });
});

it('409 es `conflict` con el borrador vigente; 400 es validation; 403 forbidden', async () => {
  stub(json({ code: 'revision_conflict', message: 'x', current: layout({ revision: 5 }) }, 409));
  const e = await layoutsApi.saveDraft(L, { zone_id: null, revision: 1, canvas_width: 8, canvas_height: 8, elements: [] }).catch((x) => x);
  expect(e).toBeInstanceOf(ApiRequestError);
  expect(toLayoutConflict(e)).toMatchObject({ state: 'conflict', current: { revision: 5 } });
  expect(layoutErrorState(e)).toMatchObject({ state: 'conflict' });

  stub(json({ code: 'revision_conflict', current: null }, 409));
  expect(toLayoutConflict(await layoutsApi.publish(L, { zone_id: null, revision: 3 }).catch((x) => x))).toEqual({ state: 'conflict', current: null });

  expect(layoutErrorState(new ApiRequestError(400, 'validation'))).toEqual({ state: 'validation' });
  expect(layoutErrorState(new ApiRequestError(403, 'permission_denied'))).toEqual({ state: 'forbidden' });
  expect(layoutErrorState(null)).toBeUndefined();
});

it('un conflicto al guardar relee el borrador; un error de validación no', async () => {
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const save = renderHook(() => useSaveLayoutDraft(L), { wrapper });
  const body = { zone_id: null, revision: 1, canvas_width: 8, canvas_height: 8, elements: [] };
  stub(json({ code: 'validation' }, 400));
  await act(() => save.result.current.mutateAsync(body).catch(() => undefined));
  expect(spy).not.toHaveBeenCalled();
  stub(json({ code: 'revision_conflict', current: null }, 409));
  await act(() => save.result.current.mutateAsync(body).catch(() => undefined));
  expect(spy).toHaveBeenCalledWith({ queryKey: ['hospitality', L, 'layouts', 'draft', 'default'] });
});

it('layout.published del local invalida los publicados; el de otro local o inválido se ignora', async () => {
  const handlers = new Map<string, (...a: any[]) => void>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const sock: RealtimeSocket = { on: (e, f) => void handlers.set(e, f), emit: () => undefined, disconnect: () => undefined };
  let server = [published];
  stub(() => json(server));
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><RealtimeProvider locationId={L} socketFactory={() => sock}>{children}</RealtimeProvider></QueryClientProvider>
  );
  const { result } = renderHook(() => useLayouts(L), { wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(1));

  server = [];
  act(() => handlers.get('layout.published')?.({ location_id: '99999999-9999-4999-8999-999999999999', zone_id: null, version: 2 }));
  act(() => handlers.get('layout.published')?.({ nonsense: true }));
  await new Promise((r) => setTimeout(r, 30));
  expect(result.current.data).toHaveLength(1);

  act(() => handlers.get('layout.published')?.({ location_id: L, zone_id: null, version: 2 }));
  await waitFor(() => expect(result.current.data).toEqual([]));
});
