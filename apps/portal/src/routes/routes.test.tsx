import { AuthProvider } from '@modivara/core-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { routes } from './routes';

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const me = (modules: string[]) => ({
  actor: { user_id: ID(3), organization_id: ID(1), username: 'ana', display_name: 'Ana', is_owner: true, is_platform: false, acting_organization_id: null },
  organization: { id: ID(1), slug: 'demo', name: 'Demo' },
  modules,
  locations: [{ id: ID(2), name: 'Centro', timezone: 'America/Bogota', permissions: [] }],
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(path: string, fetchImpl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
  return { router, client };
}

it('sin sesión redirige a /<slug>', async () => {
  const { router } = mount('/demo/app', async () => json({ code: 'unauthorized' }, 401));
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo'));
  expect(await screen.findByRole('button', { name: 'Entrar' })).toBeTruthy();
});

it('muestra solo módulos habilitados y locales de me', async () => {
  mount('/demo/app', async () => json(me(['hospitality'])));
  await screen.findByRole('navigation', { name: 'Módulos' });
  expect(screen.getByText('hospitality')).toBeTruthy();
  expect(screen.queryByText('commerce')).toBeNull();
  expect(screen.getByText('Centro')).toBeTruthy();
});

it('módulo no habilitado por URL vuelve al inicio', async () => {
  const { router } = mount('/demo/app/commerce', async () => json(me(['hospitality'])));
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo/app'));
});

it('un 401 de cualquier consulta limpia la sesión y redirige', async () => {
  let n = 0;
  const { router, client } = mount('/demo/app', async () => (n++ === 0 ? json(me(['hospitality'])) : json({ code: 'session_expired' }, 401)));
  await screen.findByRole('navigation', { name: 'Módulos' });
  // consulta cualquiera del portal que recibe 401
  await client.fetchQuery({ queryKey: ['x'], queryFn: async () => { const r = await fetch('/api/v1/x'); if (r.status === 401) throw Object.assign(new (await import('@modivara/core-web')).ApiRequestError(401, 'session_expired')); } }).catch(() => {});
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo'));
});
