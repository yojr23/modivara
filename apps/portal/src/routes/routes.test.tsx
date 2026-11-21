import { AuthProvider } from '@modivara/core-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { routes } from './routes';

// El tablero abre el tiempo real; en jsdom no hay servidor: un socket que nunca conecta.
vi.mock('socket.io-client', () => ({ io: () => ({ on: () => {}, emit: () => {}, disconnect: () => {} }) }));

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
  let sale = { id: S, currency: 'COP', status: 'open', total: '0.00', payment_method: null as string | null, opened_at: '2026-11-13T10:00:00.000Z', opened_by: ID(3), closed_at: null as string | null, closed_by: null as string | null, context_label: null, lines: [] as unknown[] };
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

/* ---------- POS-29/30: venta por mesa (composición hospitality + pos en el portal) ---------- */

const L = ID(2);
const T = ID(7);
const SALE = ID(4);
const linkedSale = { id: SALE, currency: 'COP', status: 'open', total: '0.00', payment_method: null, opened_at: '2026-11-13T10:00:00.000Z', opened_by: ID(3), closed_at: null, closed_by: null, context_label: 'Mesa 3', lines: [] };
const table = { id: T, label: 'Mesa 3', zone_id: null, zone_name: null, display_name: 'Mesa 3', position: 0 };
const layout = {
  id: ID(8), zone_id: null, version: 1, status: 'published', canvas_width: 800, canvas_height: 600, revision: 1, updated_at: '2026-11-13T10:00:00.000Z', published_at: '2026-11-13T10:00:00.000Z',
  elements: [{ type: 'table', id: ID(9), table_id: T, shape: 'round', x: 100, y: 100, rotation: 0, width: 60, height: 60 }],
};
type Req = { method: string; url: string; body?: unknown; key?: string };
/** API falsa de un bar: mesas, plano y llamados de Hospitality; catálogo vacío y `POST links` de POS. Anota cada petición. */
function barApi(m: ReturnType<typeof me>, reqs: Req[], opts: { layouts?: unknown[] } = {}) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    reqs.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: (init?.headers as Record<string, string> | undefined)?.['Idempotency-Key'] });
    if (url.endsWith('/me')) return json(m);
    if (url === `/api/v1/locations/${L}/tables`) return json([table]);
    if (url === `/api/v1/locations/${L}/layouts`) return json(opts.layouts ?? [layout]);
    if (url.startsWith(`/api/v1/locations/${L}/service-calls?`)) return json({ items: [], next_cursor: null });
    if (url === `/api/v1/locations/${L}/device-status`) return json({ connectivity: 'all_connected', tables: [], gateways: [] });
    if (url === `/api/v1/locations/${L}/pos/links`) return json({ sale: linkedSale, replayed: false }, 201);
    if (url === `/api/v1/locations/${L}/pos/sales/${SALE}`) return json(linkedSale);
    return json([]);
  };
}
const posReqs = (reqs: Req[]) => reqs.filter((r) => r.url.includes('/pos/'));
const hospitalityReqs = (reqs: Req[]) => reqs.filter((r) => /\/(tables|zones|layouts|service-calls|device-status)\b/.test(r.url));

it('Tablero: «Venta» en la ficha de la mesa abre o recupera su venta (POST links con Idempotency-Key) y lleva a Ventas', async () => {
  const reqs: Req[] = [];
  const { router } = mount('/demo/app/tablero', barApi(me(['hospitality', 'pos'], ['hospitality.calls.read', 'hospitality.tables.link_sale', 'pos.sales.read', 'pos.sales.operate']), reqs));
  fireEvent.click(await screen.findByRole('button', { name: /^Mesa 3: Sin llamados/ }));
  const sheet = await screen.findByRole('region', { name: 'Detalle de Mesa 3' });
  expect(within(sheet).queryByRole('button', { name: 'Marcar en atención' })).toBeNull(); // sin llamado: la venta no depende de él
  fireEvent.click(within(sheet).getByRole('button', { name: 'Venta' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/demo/app/ventas'));
  expect(router.state.location.search).toBe(`?venta=${SALE}`);
  const posts = reqs.filter((r) => r.method === 'POST');
  expect(posts.map((r) => [r.url, r.body])).toEqual([[`/api/v1/locations/${L}/pos/links`, { provider: 'hospitality', resource_type: 'table', resource_id: T }]]);
  expect(posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
});

it('Tablero: sin el módulo pos o sin pos.sales.operate no hay «Venta» ni peticiones a POS', async () => {
  for (const m of [me(['hospitality', 'pos'], ['hospitality.calls.read', 'hospitality.tables.link_sale', 'pos.sales.read']), me(['hospitality'], ['hospitality.calls.read', 'hospitality.tables.link_sale', 'pos.sales.operate']), me(['hospitality', 'pos'], ['hospitality.calls.read', 'pos.sales.read', 'pos.sales.operate'])]) {
    const reqs: Req[] = [];
    mount('/demo/app/tablero', barApi(m, reqs));
    fireEvent.click(await screen.findByRole('button', { name: /^Mesa 3: Sin llamados/ }));
    const sheet = await screen.findByRole('region', { name: 'Detalle de Mesa 3' });
    expect(within(sheet).queryByRole('button', { name: 'Venta' })).toBeNull();
    expect(posReqs(reqs)).toEqual([]);
    cleanup();
  }
});

it('Ventas «Por mesa»: con Hospitality lista las mesas sin plano publicado y tocar una abre su venta en Vender', async () => {
  const reqs: Req[] = [];
  const { router } = mount('/demo/app/ventas', barApi(me(['hospitality', 'pos'], ['hospitality.tables.link_sale', 'pos.sales.read', 'pos.sales.operate']), reqs, { layouts: [] }));
  fireEvent.click(await screen.findByRole('button', { name: 'Por mesa' }));
  const group = await screen.findByRole('group', { name: 'Salón principal' });
  fireEvent.click(within(group).getByRole('button', { name: 'Mesa 3' }));
  await waitFor(() => expect(router.state.location.search).toBe(`?venta=${SALE}`));
  expect(screen.getByRole('button', { name: 'Vender' }).getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByText('Toca un artículo para agregarlo.')).toBeTruthy(); // la venta de la mesa quedó en curso
  expect(within(screen.getByRole('complementary', { name: 'Venta en curso' })).getByText('Mesa 3 ·')).toBeTruthy();
  const posts = reqs.filter((r) => r.method === 'POST');
  expect(posts.map((r) => [r.url, r.body])).toEqual([[`/api/v1/locations/${L}/pos/links`, { provider: 'hospitality', resource_type: 'table', resource_id: T }]]);
  expect(posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);
});

it('Caja sin «Por mesa»: la etiqueta de la venta dice de qué mesa es, en la venta en curso, en las abiertas y en el historial', async () => {
  const other = { ...linkedSale, id: ID(8), context_label: 'Mesa 7', total: '9000.00' };
  const closed = { ...linkedSale, id: ID(9), status: 'completed', payment_method: 'card', closed_at: '2026-11-13T10:05:00.000Z', closed_by: ID(3), context_label: 'Mesa 3', lines: [
    { id: ID(6), sellable_item_id: ID(5), sku: null, name: 'Café', unit: 'unit', unit_price: '5000.00', quantity: '1.000', line_total: '5000.00', added_at: '2026-11-13T10:00:00.000Z', voided_at: null },
  ] };
  const base = `/api/v1/locations/${L}/pos`;
  mount(`/demo/app/ventas?venta=${SALE}`, async (url) => {
    if (url.endsWith('/me')) return json(me(['hospitality', 'pos'], ['pos.sales.read', 'pos.sales.operate']));
    if (url === `${base}/sales/${SALE}`) return json(linkedSale);
    if (url.startsWith(`${base}/sales?`) && url.includes('status=open')) return json([linkedSale, other]);
    if (url.startsWith(`${base}/sales?`) && url.includes('status=completed')) return json([closed]);
    return json([]);
  });
  const ticket = await screen.findByRole('complementary', { name: 'Venta en curso' });
  expect(await within(ticket).findByText('Mesa 3 ·')).toBeTruthy(); // encabezado de la venta en curso
  const openGroup = await within(ticket).findByRole('group', { name: 'Ventas abiertas' });
  expect(within(openGroup).getByRole('button', { name: /Mesa 7 · .* · 0 artículos/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
  expect(await screen.findByText('Mesa 3 · 1 artículo · Tarjeta')).toBeTruthy();
});

it('Ventas «Por mesa»: oculto en un negocio solo POS (sin peticiones a Hospitality) y sin hospitality.tables.link_sale', async () => {
  for (const m of [me(['pos'], ['pos.sales.read', 'pos.sales.operate', 'hospitality.tables.link_sale']), me(['hospitality', 'pos'], ['pos.sales.read', 'pos.sales.operate', 'hospitality.calls.read'])]) {
    const reqs: Req[] = [];
    mount('/demo/app/ventas', barApi(m, reqs));
    expect(await screen.findByRole('button', { name: 'Vender' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Por mesa' })).toBeNull();
    if (!m.modules.includes('hospitality')) expect(hospitalityReqs(reqs)).toEqual([]);
    cleanup();
  }
});

it('Vender: con ?venta= aún sin resolver (cargando o con error) ni un artículo ni «Nueva venta» abren otra venta', async () => {
  const S = ID(4);
  const item = { id: ID(5), name: 'Café', sku: null, category: null, unit: 'unit', price: '5000.00', currency: 'COP', active: true };
  const base = `/api/v1/locations/${ID(2)}/pos`;
  const posts: string[] = [];
  mount(`/demo/app/ventas?venta=${S}`, async (url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') posts.push(url);
    if (url.endsWith('/me')) return json(me(['pos'], ['pos.sales.read', 'pos.sales.operate']));
    if (url === `${base}/items`) return json([item]);
    if (url === `${base}/sales/${S}`) return json({ code: 'internal' }, 500);
    return json([]);
  });
  const cafe = await screen.findByRole('button', { name: /Café/ });
  expect((cafe as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(cafe);
  expect(await screen.findByText('No se pudo cargar la venta')).toBeTruthy();
  expect((screen.getByRole('button', { name: /Café/ }) as HTMLButtonElement).disabled).toBe(true);
  const nueva = screen.getByRole('button', { name: 'Nueva venta' }) as HTMLButtonElement;
  expect(nueva.disabled).toBe(true); // tampoco reemplaza la venta enlazada por un ticket suelto
  fireEvent.click(nueva);
  expect(posts).toEqual([]);
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

it('Vender: dos taps seguidos mientras se agrega el artículo crean una sola línea', async () => {
  const S = ID(4);
  const item = { id: ID(5), name: 'Café', sku: null, category: null, unit: 'unit', price: '5000.00', currency: 'COP', active: true };
  const open = { id: S, currency: 'COP', status: 'open', total: '0.00', payment_method: null, opened_at: '2026-11-14T15:00:00.000Z', opened_by: ID(1), closed_at: null, closed_by: null, context_label: null, lines: [] };
  const base = `/api/v1/locations/${ID(2)}/pos`;
  const posts: string[] = [];
  let release!: () => void;
  mount(`/demo/app/ventas?venta=${S}`, async (url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      posts.push(url);
      await new Promise<void>((r) => (release = r));
      return json({ sale: open, replayed: false }, 201);
    }
    if (url.endsWith('/me')) return json(me(['pos'], ['pos.sales.read', 'pos.sales.operate']));
    if (url === `${base}/items`) return json([item]);
    if (url === `${base}/sales/${S}`) return json(open);
    return json([]);
  });
  const cafe = await screen.findByRole('button', { name: /Café/ });
  await waitFor(() => expect((cafe as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(cafe);
  fireEvent.click(cafe);
  await waitFor(() => expect(posts).toEqual([`${base}/sales/${S}/lines`]));
  release();
  await waitFor(() => expect((screen.getByRole('button', { name: /Café/ }) as HTMLButtonElement).disabled).toBe(false));
  expect(posts).toHaveLength(1);
});

// MOD-52/53: cada vista consulta solo las fuentes que el negocio tiene; nada de hospitality sin hospitality.
const HOSPITALITY_URL = /\/(zones|tables|layouts|service-calls|device-status|gateways|devices)\b/;
const fetched = () => vi.mocked(fetch).mock.calls.map(([u]) => String(u));
const api = (body: ReturnType<typeof me>) => async (u?: unknown) => (String(u).endsWith('/me') ? json(body) : json([]));

it('commerce + analytics: Métricas muestra inventario y no consulta nada de hospitality', async () => {
  mount('/demo/app/metricas', api(me(['commerce', 'analytics'], ['commerce.stock.read', 'analytics.calls.read', 'analytics.inventory.read'])));
  await waitFor(() => expect(fetched().some((u) => u.includes('/metrics/inventory'))).toBe(true));
  expect(screen.queryByRole('group', { name: 'Qué medir' })).toBeNull();
  expect(fetched().filter((u) => HOSPITALITY_URL.test(u))).toEqual([]);
});

it('Espacios sin analytics no pide métricas de llamados', async () => {
  mount('/demo/app/espacios', api(me(['hospitality'], ['hospitality.tables.manage', 'hospitality.calls.read'])));
  await waitFor(() => expect(fetched().some((u) => u.includes('/tables'))).toBe(true));
  expect(fetched().filter((u) => u.includes('/metrics/'))).toEqual([]);
});
