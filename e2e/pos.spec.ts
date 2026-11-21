import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { pageAs } from './pages';
import { apiAs, json, locationOf } from './support/api';
import { authFile, type User } from './support/env';

// POS-31 / PLAN-003 T02: Tienda Demo solo tiene POS. El menú muestra Ventas (y Usuarios, que es de core), nunca Tablero,
// Inventario ni Métricas; tres casos genéricos (un zapato por SKU, una bebida en el mostrador, una hora de servicio) se venden
// por el mismo flujo con cobro declarado, en escritorio y en celular 390×844; Hospitality, Commerce y Analytics responden 403.

const ADMIN: User = ['tienda-demo', 'admin'];
const run = Date.now() % 1e6;
type Case = { name: string; sku?: string; category: string; unit: 'Unidad' | 'Hora (h)'; price: string; qty: string; total: string; pay: string; qtyText: string };
const cases = (tag: string): Case[] => ([
  { name: `E2E Zapato 42 ${tag}`, ...(tag === 'escritorio' && { sku: 'E2E-ZAP-42' }), category: 'E2E Calzado', unit: 'Unidad', price: '120000', qty: '2', total: '240.000', pay: 'Tarjeta', qtyText: '2 unidades' },
  { name: `E2E Limonada ${tag}`, category: 'E2E Bebidas', unit: 'Unidad', price: '8000', qty: '1', total: '8.000', pay: 'Efectivo', qtyText: '1 unidad' },
  { name: `E2E Asesoría ${tag}`, category: 'E2E Servicios', unit: 'Hora (h)', price: '50000', qty: '1,5', total: '75.000', pay: 'Transferencia', qtyText: '1,5 h' },
] satisfies Case[]).map((c) => ({ ...c, name: `${c.name} ${run}` }));

let api: APIRequestContext;
let loc: string;

test.beforeAll(async () => {
  api = await apiAs(ADMIN);
  loc = await locationOf(api);
  // Una corrida que falló a medias dejaría activo el SKU fijo: se desactiva para poder crearlo de nuevo.
  for (const i of await json<any[]>(api, 'GET', `/locations/${loc}/pos/items`)) {
    if (i.active && i.sku === 'E2E-ZAP-42') await json(api, 'POST', `/locations/${loc}/pos/items/${i.id}/deactivate`);
  }
});

test.afterAll(async () => {
  for (const i of await json<any[]>(api, 'GET', `/locations/${loc}/pos/items`)) {
    if (i.active && i.name.startsWith('E2E ') && i.name.endsWith(` ${run}`)) await json(api, 'POST', `/locations/${loc}/pos/items/${i.id}/deactivate`);
  }
});

async function createInCatalog(page: Page, c: Case) {
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Catálogo' }).click();
  await page.getByRole('button', { name: 'Nuevo artículo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo artículo' });
  await dialog.getByLabel('Nombre').fill(c.name);
  await dialog.getByLabel('Categoría').fill(c.category);
  if (c.sku) await dialog.getByLabel('SKU').fill(c.sku);
  await dialog.getByLabel('Unidad').selectOption({ label: c.unit });
  await dialog.getByLabel(/^Precio/).fill(c.price);
  await dialog.getByRole('button', { name: 'Crear artículo' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(c.name, { exact: true })).toBeVisible();
}

/** El mismo flujo para los tres casos: cantidad, tocar el artículo, medio de pago, cobrar; devuelve el id de la venta. */
async function sell(page: Page, c: Case): Promise<string> {
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Vender' }).click();
  await page.getByLabel('Buscar').fill(c.name);
  await page.getByLabel('Cantidad').fill(c.qty);
  await page.getByRole('group', { name: c.category }).getByRole('button', { name: new RegExp(`^${c.name}`) }).click();
  const ticket = page.getByRole('complementary', { name: 'Venta en curso' });
  await expect(ticket.getByRole('listitem').filter({ hasText: c.name })).toContainText(c.qtyText);
  await expect(page).toHaveURL(/[?&]venta=/);
  const saleId = new URL(page.url()).searchParams.get('venta')!;
  await ticket.getByLabel('Medio de pago').selectOption({ label: c.pay });
  await ticket.getByRole('button', { name: new RegExp(`^Cobrar .*${c.total.replace('.', '\\.')}`) }).click();
  await expect(page.getByText(`Venta registrada (cobro declarado): `)).toContainText(`${c.total} en ${c.pay.toLowerCase()}`);
  await expect(page).not.toHaveURL(/venta=/);
  return saleId;
}

async function checkSold(page: Page, sales: [Case, string][]) {
  // Historial: cobradas, de la más reciente a la más antigua; el detalle trae la línea y el cobro declarado.
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Historial' }).click();
  const rows = page.getByRole('main').getByRole('listitem');
  for (const [i, [c]] of [...sales].reverse().entries()) {
    await expect(rows.nth(i)).toContainText(c.total);
    await expect(rows.nth(i)).toContainText(`1 artículo · ${c.pay}`);
  }
  const [last] = sales.at(-1)!;
  await rows.first().getByRole('button').click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText(last.name);
  await expect(detail).toContainText(`Registrada · ${last.pay}`);
  await expect(detail).toContainText(last.total);
  await detail.getByRole('button', { name: 'Cerrar' }).click();

  // La API dice lo mismo: estado, total exacto, unidad y cantidad del snapshot.
  for (const [c, id] of sales) {
    const s = await json(api, 'GET', `/locations/${loc}/pos/sales/${id}`);
    expect(s.status).toBe('completed');
    expect(Number(s.total)).toBe(Number(c.total.replace('.', '')));
    expect(s.lines.map((l: any) => [l.name, l.unit, Number(l.quantity)])).toEqual([[c.name, c.unit === 'Unidad' ? 'unit' : 'h', Number(c.qty.replace(',', '.'))]]);
  }
}

async function navLabels(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Módulos' }).filter({ visible: true });
  await expect(nav.getByRole('link').first()).toBeVisible();
  return nav.getByRole('link').evaluateAll((as) => as.map((a) => a.textContent?.trim() || a.getAttribute('aria-label')));
}

test('escritorio: solo Ventas en el menú; zapato por SKU, bebida y hora de servicio por el mismo flujo, con historial', async ({ browser }) => {
  const page = await pageAs(browser, ADMIN);
  await page.goto('/tienda-demo/app');
  await expect(page).toHaveURL('/tienda-demo/app/ventas');
  expect(await navLabels(page)).toEqual(['Ventas', 'Usuarios']);
  for (const screen of ['tablero', 'inventario', 'metricas']) {
    await page.goto(`/tienda-demo/app/${screen}`);
    await expect(page).toHaveURL('/tienda-demo/app/ventas');
  }
  await expect(page.getByRole('group', { name: 'Vista' }).getByRole('button')).toHaveText(['Vender', 'Catálogo', 'Historial']); // sin «Por mesa»

  const cs = cases('escritorio');
  for (const c of cs) await createInCatalog(page, c);
  await expect(page.getByRole('listitem').filter({ hasText: cs[0]!.name })).toContainText('E2E Calzado · SKU E2E-ZAP-42 · Unidad');
  const sold: [Case, string][] = [];
  for (const c of cs) sold.push([c, await sell(page, c)]);
  await checkSold(page, sold);
});

test('solo POS: no hay «Por mesa» ni la SPA pide URLs de hospitality o de mesas', async ({ browser }) => {
  const page = await pageAs(browser, ADMIN);
  const hits: string[] = [];
  page.on('request', (r) => { if (/\/(hospitality|tables)(\/|\?|$)/.test(new URL(r.url()).pathname)) hits.push(r.url()); });
  await page.goto('/tienda-demo/app/ventas');
  const views = page.getByRole('group', { name: 'Vista' });
  await expect(views.getByRole('button', { name: 'Vender' })).toBeVisible();
  await expect(views.getByRole('button', { name: 'Por mesa' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Por mesa' })).toHaveCount(0);
  for (const v of ['Catálogo', 'Historial', 'Vender']) await views.getByRole('button', { name: v }).click();
  await page.waitForLoadState('networkidle');
  expect(hits).toEqual([]);
});

test('celular 390×844: el mismo flujo de venta', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile(ADMIN), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cs = cases('celular');
  for (const c of cs) {
    await json(api, 'POST', `/locations/${loc}/pos/items`, { name: c.name, category: c.category, unit: c.unit === 'Unidad' ? 'unit' : 'h', price: c.price });
  }
  await page.goto('/tienda-demo/app/ventas');
  expect(await navLabels(page)).toEqual(['Ventas', 'Usuarios']);
  const sold: [Case, string][] = [];
  for (const c of cs) sold.push([c, await sell(page, c)]);
  await checkSold(page, sold);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); // sin desplazamiento horizontal
  await ctx.close();
});

test('API: Hospitality, Commerce y Analytics responden 403 module_disabled; vincular una mesa da 404', async () => {
  for (const path of [
    `/locations/${loc}/tables`, `/locations/${loc}/zones`, `/locations/${loc}/service-calls?status=active`, `/locations/${loc}/layouts`,
    `/locations/${loc}/products`, `/locations/${loc}/stock/movements`, `/locations/${loc}/metrics/service-calls`,
  ]) {
    const res = await api.get(`/api/v1${path}`);
    expect(res.status(), path).toBe(403);
    expect((await res.json()).code, path).toBe('module_disabled');
  }
  const link = await api.post(`/api/v1/locations/${loc}/pos/links`, {
    headers: { 'idempotency-key': crypto.randomUUID() }, data: { provider: 'hospitality', resource_type: 'table', resource_id: crypto.randomUUID() },
  });
  expect(link.status()).toBe(404);
});
