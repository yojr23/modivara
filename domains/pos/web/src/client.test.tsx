import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiRequestError, InvalidResponseError, NetworkError, newIdempotencyKey, posApi, posErrorState, toErrorState, toPosErrorState,
  useAddSaleLine, useCompleteSale, useSales, useSellableItems,
} from './index.js';

const L = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const U = '55555555-5555-4555-8555-555555555555';
const item = { id: I, name: 'Café', sku: null, category: null, unit: 'unit', price: '5000.00', currency: 'COP', active: true };
const sale = {
  id: S, currency: 'COP', status: 'open', total: '0.00', payment_method: null, opened_at: '2026-11-13T10:00:00.000Z', opened_by: U,
  closed_at: null, closed_by: null, lines: [],
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const stub = (res: Response | (() => Response)) => {
  const f = vi.fn().mockImplementation(async () => (typeof res === 'function' ? res() : res));
  vi.stubGlobal('fetch', f);
  return f;
};
const header = (f: ReturnType<typeof stub>, i: number) => (f.mock.calls[i]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

it('valida contra el contrato, envía credenciales y codifica los parámetros de ruta', async () => {
  const f = stub(json([item]));
  expect(await posApi.listItems('a/b?x#')).toEqual([item]);
  expect(f).toHaveBeenCalledWith('/api/v1/locations/a%2Fb%3Fx%23/pos/items', expect.objectContaining({ credentials: 'include' }));
  const g = stub(json(sale));
  await posApi.getSale(L, '../x');
  expect(g.mock.calls[0]![0]).toBe(`/api/v1/locations/${L}/pos/sales/..%2Fx`);
});

it('los 409 de la venta se tipifican por su code y no se confunden con el conflicto genérico', async () => {
  stub(json({ code: 'sale_not_open', message: 'Sale is not open' }, 409));
  const e = await posApi.completeSale(L, S, { payment_method: 'cash' }).catch((x) => x);
  expect(e).toBeInstanceOf(ApiRequestError);
  expect(e.status).toBe(409);
  expect(e.name).toBe('ApiRequestError');
  expect(toPosErrorState(e)).toBe('sale_not_open');
  expect(toErrorState(e)).toBe('conflict');
  for (const code of ['empty_sale', 'idempotency_key_reused', 'currency_mismatch']) {
    stub(json({ code }, 409));
    expect(toPosErrorState(await posApi.voidSale(L, S).catch((x) => x))).toBe(code);
  }
  stub(json({ code: 'conflict' }, 409));
  expect(toPosErrorState(await posApi.createItem(L, { name: 'x', unit: 'unit', price: '1' }).catch((x) => x))).toBe('conflict');
  expect(posErrorState(null)).toBeUndefined();
  expect(posErrorState(new ApiRequestError(403, 'permission_denied'))).toBe('forbidden');
});

it('red caída y respuesta fuera de contrato tienen su propio estado', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
  const n = await posApi.listItems(L).catch((e) => e);
  expect(n).toBeInstanceOf(NetworkError);
  expect(n.name).toBe('NetworkError');
  expect(toPosErrorState(n)).toBe('network');
  stub(json([{ id: 'no-uuid' }]));
  const bad = await posApi.listItems(L).catch((e) => e);
  expect(bad).toBeInstanceOf(InvalidResponseError);
  expect(toPosErrorState(bad)).toBe('invalid_response');
});

it('cada mutación de venta lleva Idempotency-Key; un reintento reutiliza la misma y no va en el cuerpo', async () => {
  const f = stub(() => json({ sale, replayed: false }, 201));
  const key = newIdempotencyKey();
  const line = { sellable_item_id: I, quantity: '2' };
  await posApi.addLine(L, S, line, key);
  await posApi.addLine(L, S, line, key);
  expect([header(f, 0), header(f, 1)]).toEqual([key, key]);
  expect(f.mock.calls[0]![0]).toBe(`/api/v1/locations/${L}/pos/sales/${S}/lines`);
  expect(JSON.parse((f.mock.calls[0]![1] as { body: string }).body)).toEqual(line);

  await posApi.openSale(L);
  await posApi.voidLine(L, S, I);
  await posApi.completeSale(L, S, { payment_method: 'card' });
  await posApi.voidSale(L, S);
  await posApi.openLinkedSale(L, { provider: 'x', resource_type: 'y', resource_id: I });
  expect(f.mock.calls.slice(2).map(([url, init]) => [url, (init as RequestInit).method])).toEqual([
    [`/api/v1/locations/${L}/pos/sales`, 'POST'],
    [`/api/v1/locations/${L}/pos/sales/${S}/lines/${I}/void`, 'POST'],
    [`/api/v1/locations/${L}/pos/sales/${S}/complete`, 'POST'],
    [`/api/v1/locations/${L}/pos/sales/${S}/void`, 'POST'],
    [`/api/v1/locations/${L}/pos/links`, 'POST'],
  ]);
  const generated = [2, 3, 4, 5, 6].map((i) => header(f, i));
  expect(generated.every((k) => /^[0-9a-f-]{36}$/.test(k!) && k !== key)).toBe(true);
  expect(new Set(generated).size).toBe(5);
});

it('los filtros del historial viajan en el query string', async () => {
  const f = stub(json([]));
  await posApi.listSales(L, { status: 'completed', limit: 20, cursor: 'c' });
  expect(f.mock.calls[0]![0]).toBe(`/api/v1/locations/${L}/pos/sales?status=completed&limit=20&cursor=c`);
});

it('useSellableItems expone el catálogo del local', async () => {
  stub(json([item]));
  const { wrapper } = setup();
  const { result } = renderHook(() => useSellableItems(L), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual([item]));
});

it('una mutación de venta deja la venta en caché e invalida ventas del local (detalle incluido), no el catálogo', async () => {
  const withLine = { ...sale, total: '10000.00' };
  stub(() => json({ sale: withLine, replayed: false }, 201));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useAddSaleLine(L), { wrapper });
  await act(() => result.current.mutateAsync({ saleId: S, input: { sellable_item_id: I, quantity: '2' }, idempotencyKey: newIdempotencyKey() }));
  expect(spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey)).toEqual([['pos', L, 'sales']]);
  expect(qc.getQueryData(['pos', L, 'sales', S])).toEqual(withLine);
});

it('un 409 sale_not_open también recarga la venta (otra persona la cerró) y queda tipificado en el hook', async () => {
  stub(json({ code: 'sale_not_open' }, 409));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useCompleteSale(L), { wrapper });
  await act(() => result.current.mutateAsync({ saleId: S, input: { payment_method: 'cash' }, idempotencyKey: newIdempotencyKey() }).catch(() => undefined));
  await waitFor(() => expect(posErrorState(result.current.error)).toBe('sale_not_open'));
  expect(spy).toHaveBeenCalledWith({ queryKey: ['pos', L, 'sales'] });
});

it('el historial pide limit+1 y sigue el cursor (opened_at, id) de la última venta visible', async () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...sale, status: 'completed', id: `33333333-3333-4333-8333-33333333333${i}` }));
  const f = stub(() => json(rows(3)));
  const { wrapper } = setup();
  const { result } = renderHook(() => useSales(L, { status: 'completed', limit: 2 }), { wrapper });
  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(String(f.mock.calls[0]![0])).toContain('status=completed&limit=3');
  expect(result.current.data!.pages[0]).toHaveLength(2);
  expect(result.current.hasNextPage).toBe(true);
  await act(() => result.current.fetchNextPage());
  expect(String(f.mock.calls[1]![0])).toContain(`cursor=${encodeURIComponent(`${sale.opened_at}_${rows(2)[1]!.id}`)}`);
});
