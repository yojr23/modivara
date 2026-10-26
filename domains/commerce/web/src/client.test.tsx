import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ApiRequestError, InvalidResponseError, NetworkError, commerceApi, newIdempotencyKey, stockErrorState, toErrorState, toStockErrorState,
  useProducts, useRegisterMovement,
} from './index.js';

const L = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const S = '33333333-3333-4333-8333-333333333333';
const R = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const product = { id: P, name: 'Cerveza', sku: null, category: null, unit: 'bottle', active: true };
const movement = {
  id: '66666666-6666-4666-8666-666666666666', stock_location_id: S, product_id: P, direction: 'out', reason_id: R, delta: '-1.000',
  balance_after: '9.000', note: null, actor_user_id: U, occurred_at: '2026-10-25T10:00:00.000Z',
};
const out = { stock_location_id: S, product_id: P, reason_id: R, direction: 'out' as const, quantity: '1' };
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
  const f = stub(json([product]));
  expect(await commerceApi.listProducts('a/b?x#')).toEqual([product]);
  expect(f).toHaveBeenCalledWith('/api/v1/locations/a%2Fb%3Fx%23/products', expect.objectContaining({ credentials: 'include' }));
});

it('el saldo insuficiente se tipifica para la UI y no se confunde con otros 409', async () => {
  stub(json({ code: 'insufficient_stock', message: 'Insufficient stock' }, 409));
  const e = await commerceApi.registerMovement(L, out).catch((x) => x);
  expect(e).toBeInstanceOf(ApiRequestError);
  expect(e.code).toBe('insufficient_stock');
  expect(toStockErrorState(e)).toBe('insufficient_stock');
  expect(toErrorState(e)).toBe('conflict'); // el estado genérico sigue siendo 409

  stub(json({ code: 'conflict' }, 409));
  expect(toStockErrorState(await commerceApi.createProduct(L, { name: 'x', unit: 'unit' }).catch((x) => x))).toBe('conflict');
  stub(json({ code: 'idempotency_key_reused' }, 409));
  expect(toStockErrorState(await commerceApi.registerMovement(L, out).catch((x) => x))).toBe('idempotency_key_reused');
  expect(stockErrorState(null)).toBeUndefined();
  expect(stockErrorState(new ApiRequestError(403, 'permission_denied'))).toBe('forbidden');
});

it('403, 404 y 400 se traducen a estados tipados; red y respuesta inválida también', async () => {
  expect(toErrorState(new ApiRequestError(403, 'x'))).toBe('forbidden');
  expect(toErrorState(new ApiRequestError(404, 'x'))).toBe('not_found');
  expect(toErrorState(new ApiRequestError(400, 'x'))).toBe('validation');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
  const n = await commerceApi.listProducts(L).catch((e) => e);
  expect(n).toBeInstanceOf(NetworkError);
  expect(toStockErrorState(n)).toBe('network');
  stub(json([{ id: 'no-uuid' }]));
  const bad = await commerceApi.listProducts(L).catch((e) => e);
  expect(bad).toBeInstanceOf(InvalidResponseError);
  expect(toStockErrorState(bad)).toBe('invalid_response');
});

it('el movimiento lleva el header Idempotency-Key; la misma clave en un reintento', async () => {
  const f = stub(() => json({ movement, replayed: false }, 201));
  const key = newIdempotencyKey();
  await commerceApi.registerMovement(L, out, key);
  await commerceApi.registerMovement(L, out, key);
  const headers = f.mock.calls.map(([, init]) => (init as { headers: Record<string, string> }).headers['Idempotency-Key']);
  expect(headers).toEqual([key, key]);
  expect(f.mock.calls[0]![0]).toBe(`/api/v1/locations/${L}/stock/movements`);
  expect(JSON.parse((f.mock.calls[0]![1] as { body: string }).body)).toEqual(out); // la clave no va en el cuerpo
  await commerceApi.registerMovement(L, out);
  const generated = (f.mock.calls[2]![1] as { headers: Record<string, string> }).headers['Idempotency-Key'];
  expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  expect(generated).not.toBe(key);
});

it('los filtros viajan en el query string', async () => {
  const f = stub(json([]));
  await commerceApi.listMovements(L, { productId: P, limit: 20 });
  expect(f.mock.calls[0]![0]).toBe(`/api/v1/locations/${L}/stock/movements?product_id=${P}&limit=20`);
});

it('useProducts expone los datos por local', async () => {
  stub(json([product]));
  const { wrapper } = setup();
  const { result } = renderHook(() => useProducts(L), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual([product]));
});

it('registrar un movimiento invalida saldos e historial del local, no el catálogo ni otros locales', async () => {
  stub(() => json({ movement, replayed: false }, 201));
  const { qc, wrapper } = setup();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => useRegisterMovement(L), { wrapper });
  await act(() => result.current.mutateAsync({ input: out }));
  const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
  expect(keys).toEqual([['commerce', L, 'balances'], ['commerce', L, 'movements']]);
});

it('un saldo insuficiente en la mutación queda tipificado en el error del hook', async () => {
  stub(json({ code: 'insufficient_stock' }, 409));
  const { wrapper } = setup();
  const { result } = renderHook(() => useRegisterMovement(L), { wrapper });
  await act(() => result.current.mutateAsync({ input: out }).catch(() => undefined));
  await waitFor(() => expect(stockErrorState(result.current.error)).toBe('insufficient_stock'));
});
