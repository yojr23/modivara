import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { toErrorState, useCreateUser, useDeactivateUser, useSetLocationRoles, useUsers, usersApi } from './index.js';
import { LOC, json } from './testing/fixtures.js';

const U = '44444444-4444-4444-8444-444444444444';
const user = { id: U, username: 'ana', display_name: 'Ana', is_owner: false, active: true };
/** Respuestas en orden; después, la lista de usuarios (los refetch). */
const stub = (...res: Response[]) => {
  const f = vi.fn();
  res.forEach((r) => f.mockResolvedValueOnce(r));
  f.mockImplementation(async () => json({ users: [user] }));
  vi.stubGlobal('fetch', f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

it('useUsers lista usuarios validando contra el contrato', async () => {
  const f = stub(json({ users: [user] }));
  const { wrapper } = setup();
  const { result } = renderHook(() => useUsers(), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual([user]));
  expect(f).toHaveBeenCalledWith('/api/v1/users', expect.objectContaining({ credentials: 'include' }));
});

it('crear usuario hace POST y refresca la lista', async () => {
  const f = stub(json({ users: [] }), json(user));
  const { wrapper } = setup();
  const { result } = renderHook(() => ({ list: useUsers(), create: useCreateUser() }), { wrapper });
  await waitFor(() => expect(result.current.list.data).toEqual([]));
  await act(() => result.current.create.mutateAsync({ username: 'ana', display_name: 'Ana', password: 'Str0ng-passw0rd!' }));
  expect(f).toHaveBeenCalledWith('/api/v1/users', expect.objectContaining({ method: 'POST' }));
  await waitFor(() => expect(result.current.list.data).toEqual([user]));
});

it('roles por local: PUT con ids en la ruta e invalida', async () => {
  const f = stub(json({ users: [user] }), json({ id: U, user_id: U, location_id: LOC, roles: ['staff'] }));
  const { wrapper } = setup();
  const { result } = renderHook(() => ({ list: useUsers(), roles: useSetLocationRoles() }), { wrapper });
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  await act(() => result.current.roles.mutateAsync({ userId: U, locationId: LOC, input: { roles: ['staff'] } }));
  expect(f).toHaveBeenCalledWith(`/api/v1/users/${U}/locations/${LOC}/roles`, expect.objectContaining({ method: 'PUT', body: '{"roles":["staff"]}' }));
  await waitFor(() => expect(f.mock.calls.length).toBe(3)); // lista, PUT, nueva lista
});

it('desactivar acepta 204 y refresca', async () => {
  const f = stub(json({ users: [user] }), new Response(null, { status: 204 }));
  const { wrapper } = setup();
  const { result } = renderHook(() => ({ list: useUsers(), off: useDeactivateUser() }), { wrapper });
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  await act(() => result.current.off.mutateAsync(U));
  expect(f).toHaveBeenCalledWith(`/api/v1/users/${U}/deactivate`, expect.objectContaining({ method: 'POST' }));
  await waitFor(() => expect(f.mock.calls.length).toBe(3));
});

it('errores 403, 409 (usuario duplicado) y 400 (contraseña débil) se tipan', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'forbidden' }, 403)));
  expect(toErrorState(await usersApi.list().catch((e) => e))).toBe('forbidden');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'username_taken' }, 409)));
  const dup = await usersApi.create({ username: 'ana', display_name: 'Ana', password: 'x' }).catch((e) => e);
  expect(dup.code).toBe('username_taken');
  expect(toErrorState(dup)).toBe('conflict');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'weak_password' }, 400)));
  expect(toErrorState(await usersApi.resetPassword(U, { new_password: 'x' }).catch((e) => e))).toBe('validation');
});
