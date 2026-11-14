import { AuthProvider } from '@modivara/core-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { routes } from './routes';

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const me = (modules: string[], permissions: string[] = ['commerce.stock.read']) => ({
  actor: { user_id: ID(3), organization_id: ID(1), username: 'ana', display_name: 'Ana', is_owner: true, is_platform: false, acting_organization_id: null },
  organization: { id: ID(1), slug: 'demo', name: 'Demo' },
  modules,
  locations: [{ id: ID(2), name: 'Centro', timezone: 'America/Bogota', permissions }],
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(path: string, fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
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

it('abre la primera pantalla permitida y la navegación solo muestra módulos habilitados con permiso', async () => {
  const { router } = mount('/demo/app', async () => json(me(['commerce', 'analytics'])));
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo/app/inventario'));
  const [nav] = await screen.findAllByRole('navigation', { name: 'Módulos' });
  expect(within(nav!).getByText('Inventario')).toBeTruthy();
  expect(within(nav!).queryByText('Métricas')).toBeNull(); // analytics contratado, pero sin permiso analytics.*
  expect(within(nav!).queryByText('Tablero')).toBeNull();
  expect(screen.getByText('Local Centro')).toBeTruthy();
});

it('pantalla no permitida por URL vuelve al inicio', async () => {
  const { router } = mount('/demo/app/inventario', async () => json(me(['hospitality'], [])));
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo/app'));
  expect(await screen.findByText('Nada que mostrar todavía')).toBeTruthy();
});

it('un 401 de cualquier consulta limpia la sesión y redirige', async () => {
  let n = 0;
  const { router, client } = mount('/demo/app', async () => (n++ === 0 ? json(me(['commerce'])) : json({ code: 'session_expired' }, 401)));
  await screen.findAllByRole('navigation', { name: 'Módulos' });
  // consulta cualquiera del portal que recibe 401
  await client.fetchQuery({ queryKey: ['x'], queryFn: async () => { const r = await fetch('/api/v1/x'); if (r.status === 401) throw Object.assign(new (await import('@modivara/core-web')).ApiRequestError(401, 'session_expired')); } }).catch(() => {});
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo'));
});

it('Ventas aparece con el módulo pos y pos.sales.read; sin el módulo, no', async () => {
  const api = (m: ReturnType<typeof me>) => async (url: string) => json(url.endsWith('/me') ? m : []);
  const { router } = mount('/demo/app', api(me(['pos'], ['pos.sales.read'])));
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo/app/ventas'));
  const [nav] = await screen.findAllByRole('navigation', { name: 'Módulos' });
  expect(within(nav!).getByText('Ventas')).toBeTruthy();
  expect(await screen.findByText('Aún no hay ventas cobradas')).toBeTruthy(); // solo lectura: abre el historial
  expect(screen.queryByRole('button', { name: 'Vender' })).toBeNull();
  cleanup();

  mount('/demo/app', api(me(['commerce'], ['commerce.stock.read', 'pos.sales.read'])));
  const [nav2] = await screen.findAllByRole('navigation', { name: 'Módulos' });
  expect(within(nav2!).queryByText('Ventas')).toBeNull();
});

it('Vender: tocar un artículo abre la venta y agrega la línea con Idempotency-Key; Cobrar la cierra con el medio elegido', async () => {
  const S = ID(4);
  const item = { id: ID(5), name: 'Café', sku: null, category: null, unit: 'unit', price: '5000.00', currency: 'COP', active: true };
  const line = { id: ID(6), sellable_item_id: item.id, sku: null, name: 'Café', unit: 'unit', unit_price: '5000.00', quantity: '2.000', line_total: '10000.00', added_at: '2026-11-13T10:00:00.000Z', voided_at: null };
  let sale = { id: S, currency: 'COP', status: 'open', total: '0.00', payment_method: null as string | null, opened_at: '2026-11-13T10:00:00.000Z', opened_by: ID(3), closed_at: null as string | null, closed_by: null as string | null, lines: [] as unknown[] };
  const calls: { method: string; url: string; body?: unknown; key?: string }[] = [];
  const base = `/api/v1/locations/${ID(2)}/pos`;
  const { router } = mount('/demo/app/ventas', async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: (init?.headers as Record<string, string>)['Idempotency-Key'] });
    if (url.endsWith('/me')) return json(me(['pos'], ['pos.sales.read', 'pos.sales.operate']));
    if (url === `${base}/items`) return json([item]);
    if (url.startsWith(`${base}/sales?`)) return json([]);
    if (url === `${base}/sales/${S}`) return json(sale);
    if (url === `${base}/sales`) return json({ sale, replayed: false }, 201);
    if (url === `${base}/sales/${S}/lines`) sale = { ...sale, total: '10000.00', lines: [line] };
    if (url === `${base}/sales/${S}/complete`) sale = { ...sale, status: 'completed', payment_method: 'card', closed_at: '2026-11-13T10:05:00.000Z', closed_by: ID(3) };
    return json({ sale, replayed: false }, 201);
  });

  const qty = await screen.findByLabelText('Cantidad');
  fireEvent.change(qty, { target: { value: '1,5' } });
  fireEvent.click(screen.getByRole('button', { name: /Café/ }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/por unidad/); // `unit` solo admite enteros
  expect(calls).toEqual([]);

  fireEvent.change(qty, { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: /Café/ }));
  await screen.findByRole('button', { name: 'Anular Café' });
  await waitFor(() => expect(router.state.location.search).toBe(`?venta=${S}`)); // enlazable desde otras pantallas
  expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
    ['POST', `${base}/sales`, undefined],
    ['POST', `${base}/sales/${S}/lines`, { sellable_item_id: item.id, quantity: '2' }],
  ]);
  expect(calls.every((c) => /^[0-9a-f-]{36}$/.test(c.key ?? ''))).toBe(true);

  fireEvent.change(screen.getByLabelText('Medio de pago'), { target: { value: 'card' } });
  fireEvent.click(screen.getByRole('button', { name: /^Cobrar/ }));
  expect(await screen.findByText(/Venta cobrada: \$\s10\.000 en tarjeta/)).toBeTruthy();
  expect(calls[2]).toMatchObject({ method: 'POST', url: `${base}/sales/${S}/complete`, body: { payment_method: 'card' } });
  await waitFor(() => expect(router.state.location.search).toBe(''));
  expect(screen.getByText('Toca un artículo para empezar una venta.')).toBeTruthy();
});

it('la portada pide el negocio, valida el slug y lleva a su login', async () => {
  const { router } = mount('/', async () => json({ code: 'unauthorized' }, 401));
  const input = await screen.findByLabelText(/Identificador de tu negocio/);
  fireEvent.change(input, { target: { value: 'Mal Slug' } });
  fireEvent.submit(input.closest('form')!);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(router.state.location.pathname).toBe('/');
  fireEvent.change(input, { target: { value: ' Bar-Demo ' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(router.state.location.pathname).toBe('/bar-demo'));
});
