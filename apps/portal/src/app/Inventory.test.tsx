import { AuthProvider } from '@modivara/core-web';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { routes } from '@/routes/routes';

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = new Date().toISOString();
const me = {
  actor: { user_id: ID(3), organization_id: ID(1), username: 'ana', display_name: 'Ana', is_owner: true, is_platform: false, acting_organization_id: null },
  organization: { id: ID(1), slug: 'demo', name: 'Demo' },
  modules: ['commerce'],
  locations: [{ id: ID(2), name: 'Centro', timezone: 'America/Bogota', permissions: ['commerce.stock.read', 'commerce.stock.write'] }],
};
const limon = { id: ID(4), name: 'Limón', sku: null, category: null, unit: 'kg', active: true };
const place = { id: ID(5), name: 'Principal', is_default: true, active: true };
const compra = { id: ID(6), name: 'Compra', direction: 'in', active: true };
const movement = (productId: string, delta: string) => ({
  id: ID(7), stock_location_id: place.id, product_id: productId, direction: 'in', reason_id: compra.id, delta, balance_after: delta,
  note: null, actor_user_id: ID(3), actor_name: 'Ana', occurred_at: NOW,
});
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Monta Inventario con una API falsa; `products` responde la lista de cada llamada (la última se repite). */
function mount({ products = [[limon]], today = [] as unknown[] } = {}) {
  let productCalls = 0;
  const fetchMock = vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    if (url.endsWith('/me')) return json(me);
    if (url.includes('/products')) return json(products[Math.min(productCalls++, products.length - 1)]);
    if (url.includes('/stock-locations')) return json([place]);
    if (url.includes('/movement-reasons')) return json([compra]);
    if (url.includes('/stock/balances')) return json([]);
    if (url.includes('/stock/movements') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { product_id: string; quantity: string };
      return json({ movement: movement(body.product_id, body.quantity), replayed: false });
    }
    if (url.includes('/stock/movements')) return json(today);
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter(routes, { initialEntries: ['/demo/app/inventario'] });
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
  const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)) as { quantity: string });
  return { fetchMock, posts };
}

async function enter(text: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Entrada' }, { timeout: 5000 }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Registrar entrada' }));
}

it('acepta la coma decimal: «0,5» kg registra 0.5', async () => {
  const { posts } = mount();
  await enter('0,5');
  await waitFor(() => expect(posts()).toHaveLength(1));
  expect(posts()[0]!.quantity).toBe('0.500');
});

it('una cantidad que no es número se explica y no se envía', async () => {
  const { posts } = mount();
  await enter('1,2,3');
  expect(await screen.findByText(/Escribe la cantidad con números/)).toBeTruthy();
  expect(posts()).toEqual([]);
});

it('un movimiento de un producto que la caché no tiene relee los productos en vez de llamarlo desactivado', async () => {
  const zapato = { ...limon, id: ID(8), name: 'Zapato 40', unit: 'unit' };
  const viejo = { ...limon, id: ID(9), name: 'Viejo', active: false };
  mount({ products: [[limon, viejo], [limon, viejo, zapato]], today: [{ ...movement(zapato.id, '2.000') }, { ...movement(viejo.id, '1.000'), id: ID(1) }] });
  const feed = await screen.findByRole('complementary', {}, { timeout: 5000 });
  await waitFor(() => expect(within(feed).getByText('Zapato 40')).toBeTruthy(), { timeout: 5000 });
  expect(within(feed).getByText('Producto desactivado')).toBeTruthy();
}, 15_000);
