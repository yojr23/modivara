import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { BoardPage, pageAs } from './pages';
import { apiAs, closeActiveCalls, json, locationOf, posPost, press, tableId } from './support/api';
import { authFile } from './support/env';

// POS-26 / PLAN-003 T08: Bar Demo con Hospitality + POS. La venta de una mesa se abre desde la ficha del tablero (escritorio) y
// desde Ventas «Por mesa» (celular): los dos llegan a la MISMA venta, y Caja también. El llamado y la venta no se tocan:
// finalizar el llamado deja la venta abierta y cobrar la venta no cambia el llamado.
// T07/T09: Pisos (sin POS) no ve «Venta» ni «Ventas» y la API de POS responde 403. T14: una venta de Bar Demo no existe para
// Tienda Demo (404). T12 (revocar POS a un negocio) no se prueba aquí: cambiar módulos exige escribir en la base; lo cubre la
// prueba de integración de Core.

const ADMIN = ['bar-demo', 'admin'] as const;
const CAJA = ['bar-demo', 'caja1'] as const;
const TABLE = 'Mesa 5';
const BUTTON = 'btn-05';
const ITEM = `E2E Cerveza ${Date.now() % 1e6}`;

let admin: APIRequestContext;
let loc: string;
let table: string;
let itemId: string;

const link = (ctx: APIRequestContext) => posPost(ctx, `/locations/${loc}/pos/links`, { provider: 'hospitality', resource_type: 'table', resource_id: table });
const saleIdOf = (page: Page) => new URL(page.url()).searchParams.get('venta');
const ticket = (page: Page) => page.getByRole('complementary', { name: 'Venta en curso' });
const view = (page: Page, name: string) => page.getByRole('group', { name: 'Vista' }).getByRole('button', { name, exact: true });

async function addItem(page: Page, qty: string) {
  await page.getByLabel('Cantidad').fill(qty);
  await page.getByRole('button', { name: new RegExp(`^${ITEM}`) }).click();
}

test.beforeAll(async () => {
  admin = await apiAs(ADMIN);
  loc = await locationOf(admin);
  table = await tableId(admin, loc, TABLE);
  itemId = (await json(admin, 'POST', `/locations/${loc}/pos/items`, { name: ITEM, category: 'E2E Bar', unit: 'unit', price: '9000' })).id;
  // La mesa empieza sin venta abierta (una corrida anterior pudo dejarla): se abre o recupera y se anula.
  const { sale } = await link(admin);
  await posPost(admin, `/locations/${loc}/pos/sales/${sale.id}/void`);
  await closeActiveCalls(admin, loc, table);
});

test.afterAll(async () => {
  await closeActiveCalls(admin, loc, table);
  await json(admin, 'POST', `/locations/${loc}/pos/items/${itemId}/deactivate`);
});

test('la venta de la mesa: tablero, «Por mesa» en celular y Caja llegan a la misma; llamado y venta independientes', async ({ browser }) => {
  // Escritorio: ficha de la mesa en el plano → «Venta» → Ventas con esa venta.
  const board = new BoardPage(await pageAs(browser, ADMIN));
  await board.goto('bar-demo');
  await board.planTable(TABLE).click();
  await board.page.getByRole('region', { name: `Detalle de ${TABLE}` }).getByRole('button', { name: 'Venta' }).click();
  await expect(board.page).toHaveURL(/\/bar-demo\/app\/ventas\?venta=/);
  const saleId = saleIdOf(board.page)!;
  await expect(ticket(board.page).getByText(new RegExp(`${TABLE} ·`)).first()).toBeVisible(); // la venta dice de qué mesa es
  await addItem(board.page, '1');
  await expect(ticket(board.page).getByRole('listitem').filter({ hasText: ITEM })).toContainText('1 unidad');

  // Celular 390×844: Ventas «Por mesa» → la misma mesa → la misma venta, con la línea del tablero.
  const ctx = await browser.newContext({ storageState: authFile([...ADMIN]), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  await phone.goto('/bar-demo/app/ventas');
  await view(phone, 'Por mesa').click();
  await phone.getByRole('button', { name: new RegExp(`· ${TABLE}$`) }).click(); // «zona · mesa»
  await expect(view(phone, 'Vender')).toHaveAttribute('aria-pressed', 'true');
  expect(saleIdOf(phone)).toBe(saleId);
  await expect(ticket(phone).getByRole('listitem').filter({ hasText: ITEM })).toContainText('1 unidad');
  await addItem(phone, '2');
  await expect(ticket(phone)).toContainText('27.000');
  await ctx.close();

  // Caja (sin hospitality.calls.read): no ve «Por mesa» ni el tablero, pero vincular la mesa por la API devuelve la misma venta.
  const caja = await apiAs([...CAJA]);
  const again = await link(caja);
  expect([again.sale.id, again.replayed]).toEqual([saleId, true]);

  // La mesa llama mientras Caja cobra la venta desde Ventas: el llamado sigue pendiente.
  const press1 = await press('bar-demo', BUTTON);
  expect(press1.result).toBe('call_created');
  const cashier = await pageAs(browser, [...CAJA]);
  await cashier.goto(`/bar-demo/app/ventas?venta=${saleId}`);
  await expect(cashier.getByRole('navigation', { name: 'Módulos' }).first().getByRole('link')).toHaveText(['Ventas']);
  await expect(cashier.getByRole('group', { name: 'Vista' }).getByRole('button')).toHaveText(['Vender', 'Por mesa', 'Historial']); // Caja tiene hospitality.tables.link_sale (21/11)
  await expect(ticket(cashier).getByRole('listitem')).toHaveCount(2);
  await expect(ticket(cashier).getByText(new RegExp(`${TABLE} ·`)).first()).toBeVisible(); // la venta dice de qué mesa es
  await ticket(cashier).getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
  await ticket(cashier).getByRole('button', { name: /^Cobrar .*27\.000/ }).click();
  await expect(cashier.getByText('Venta registrada (cobro declarado): ')).toContainText('27.000 en efectivo');
  await view(cashier, 'Historial').click();
  await expect(cashier.getByRole('button', { name: new RegExp(`${TABLE} · 2 artículos · Efectivo`) }).first()).toBeVisible();

  const sale = await json(admin, 'GET', `/locations/${loc}/pos/sales/${saleId}`);
  expect([sale.status, sale.total, sale.payment_method]).toEqual(['completed', '27000.00', 'cash']);
  const callPath = `/locations/${loc}/service-calls/${press1.service_call_id}`;
  expect((await json(admin, 'GET', callPath)).status).toBe('pending');
  await board.goto('bar-demo'); // «Venta» lo había llevado a Ventas
  await expect(board.queueCard(TABLE)).toBeVisible(); // el tablero sigue mostrando el llamado

  // Cobrada la venta, la mesa queda libre: vincularla abre otra. Finalizar el llamado no la cierra ni le quita líneas.
  const next = (await link(admin)).sale;
  expect(next.id).not.toBe(saleId);
  await posPost(admin, `/locations/${loc}/pos/sales/${next.id}/lines`, { sellable_item_id: itemId, quantity: '1' });
  await json(admin, 'POST', `${callPath}/acknowledge`);
  await json(admin, 'POST', `${callPath}/complete`);
  await expect(board.queueCard(TABLE)).toHaveCount(0);
  const after = await json(admin, 'GET', `/locations/${loc}/pos/sales/${next.id}`);
  expect([after.status, after.total, after.lines.length]).toEqual(['open', '9000.00', 1]);
  await posPost(admin, `/locations/${loc}/pos/sales/${next.id}/void`);
});

test('Bar Demo Pisos (sin POS): ni «Venta» en la ficha de la mesa ni «Ventas» en el menú; la API de POS responde 403', async ({ browser }) => {
  const page = await pageAs(browser, ['bar-demo-pisos', 'admin']);
  const board = new BoardPage(page);
  await board.goto('bar-demo-pisos');
  const mesa = page.getByRole('region', { name: /^Plano de / }).first().getByRole('button', { name: /^Mesa \d+: / }).first();
  const label = (await mesa.getAttribute('aria-label'))!.split(':')[0]!;
  await mesa.click();
  const sheet = page.getByRole('region', { name: `Detalle de ${label}` });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Venta' })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Módulos' }).first().getByRole('link', { name: 'Ventas' })).toHaveCount(0);
  await page.goto('/bar-demo-pisos/app/ventas');
  await expect(page).toHaveURL('/bar-demo-pisos/app/tablero');

  const api = await apiAs(['bar-demo-pisos', 'admin']);
  const pisos = await locationOf(api);
  for (const res of [
    await api.get(`/api/v1/locations/${pisos}/pos/items`),
    await api.get(`/api/v1/locations/${pisos}/pos/sales`),
    await api.post(`/api/v1/locations/${pisos}/pos/links`, { headers: { 'idempotency-key': crypto.randomUUID() }, data: { provider: 'hospitality', resource_type: 'table', resource_id: crypto.randomUUID() } }),
  ]) {
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe('module_disabled');
  }
});

test('una venta de Bar Demo no existe para Tienda Demo (404), ni en su local ni en el de Bar Demo', async () => {
  const { sale } = await posPost(admin, `/locations/${loc}/pos/sales`);
  try {
    const tienda = await apiAs(['tienda-demo', 'admin']);
    const own = await locationOf(tienda);
    for (const l of [own, loc]) {
      expect((await tienda.get(`/api/v1/locations/${l}/pos/sales/${sale.id}`)).status()).toBe(404);
      const res = await tienda.post(`/api/v1/locations/${l}/pos/sales/${sale.id}/void`, { headers: { 'idempotency-key': crypto.randomUUID() } });
      expect(res.status()).toBe(404);
    }
  } finally {
    await posPost(admin, `/locations/${loc}/pos/sales/${sale.id}/void`);
  }
});
