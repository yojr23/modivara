import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { pageAs } from './pages';
import { apiAs, json, locationOf, posPost } from './support/api';
import { authFile, type User } from './support/env';

// Casos borde de Ventas (POS) que no cubren pos.spec ni pos-tables.spec: cantidades por unidad, venta vacía, anular una línea,
// venta registrada de solo lectura, catálogo duplicado o desactivado, permisos de Caja y del personal sin POS, idempotencia,
// aislamiento entre negocios, historial por estado y páginas, y cambio de moneda del local (se restaura al final).

const TIENDA: User = ['tienda-demo', 'admin'];
const BAR: User = ['bar-demo', 'admin'];
const CAJA: User = ['bar-demo', 'caja1'];
const run = Date.now() % 1e6;
const UNIT = { name: `E2E Borde Vaso ${run}`, unit: 'unit', price: '10000' };
const KG = { name: `E2E Borde Queso ${run}`, unit: 'kg', price: '20000' };
const CHEAP = { name: `E2E Borde Chicle ${run}`, unit: 'unit', price: '5000' };

let tienda: APIRequestContext;
let bar: APIRequestContext;
let loc: string;
let barLoc: string;
const ids: Record<string, string> = {};

/** Mutación de POS cruda (para comprobar errores): clave nueva salvo que se pase una. */
const pos = (ctx: APIRequestContext, path: string, data?: unknown, key: string = randomUUID()) =>
  ctx.post(`/api/v1${path}`, { data, headers: { 'idempotency-key': key } });
async function expectError(res: APIResponse, status: number, code?: string) {
  expect(res.status(), await res.text()).toBe(status);
  if (code) expect((await res.json()).code).toBe(code);
}
const sales = (l = loc) => `/locations/${l}/pos/sales`;
const ticket = (page: Page) => page.getByRole('complementary', { name: 'Venta en curso' });
const saleIdOf = (page: Page) => new URL(page.url()).searchParams.get('venta');

async function tap(page: Page, name: string, qty: string) {
  await page.getByLabel('Buscar').fill(name);
  await page.getByLabel('Cantidad').fill(qty);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

test.beforeAll(async () => {
  tienda = await apiAs(TIENDA);
  bar = await apiAs(BAR);
  loc = await locationOf(tienda);
  barLoc = await locationOf(bar);
  for (const i of [UNIT, KG, CHEAP]) ids[i.name] = (await json(tienda, 'POST', `/locations/${loc}/pos/items`, { ...i, category: 'E2E Borde' })).id;
  ids.bar = (await json(bar, 'POST', `/locations/${barLoc}/pos/items`, { name: `E2E Borde Agua ${run}`, unit: 'unit', price: '3000' })).id;
});

test.afterAll(async () => {
  for (const [ctx, l] of [[tienda, loc], [bar, barLoc]] as const) {
    for (const i of await json<any[]>(ctx, 'GET', `/locations/${l}/pos/items`)) {
      if (i.active && i.name.endsWith(` ${run}`)) await json(ctx, 'POST', `/locations/${l}/pos/items/${i.id}/deactivate`);
    }
  }
});

test('cantidades: «Unidad» rechaza 0, negativas y decimales; kg acepta hasta 3 decimales', async ({ browser }) => {
  const page = await pageAs(browser, TIENDA);
  await page.goto('/tienda-demo/app/ventas');
  for (const qty of ['0', '-1', '1,5']) {
    await tap(page, UNIT.name, qty);
    await expect(page.getByRole('alert')).toHaveText(`${UNIT.name} se vende por unidad: escribe una cantidad entera mayor que cero.`);
  }
  for (const qty of ['0', '1,2345']) {
    await tap(page, KG.name, qty);
    await expect(page.getByRole('alert')).toHaveText('Escribe una cantidad mayor que cero, con hasta 3 decimales.');
  }
  await expect(page).not.toHaveURL(/venta=/); // nada de lo anterior abrió una venta
  await tap(page, KG.name, '0,125');
  await expect(ticket(page).getByRole('listitem').filter({ hasText: KG.name })).toContainText('0,125 kg');
  await expect(ticket(page).getByRole('button', { name: /^Cobrar .*2\.500/ })).toBeEnabled();
  const saleId = saleIdOf(page)!;

  // La API aplica la misma regla aunque el cliente no la valide.
  for (const quantity of ['1.5', '0']) await expectError(await pos(tienda, `${sales()}/${saleId}/lines`, { sellable_item_id: ids[UNIT.name], quantity }), 400, 'invalid_quantity');
  await expectError(await pos(tienda, `${sales()}/${saleId}/lines`, { sellable_item_id: ids[UNIT.name], quantity: '-1' }), 400);
  await expectError(await pos(tienda, `${sales()}/${saleId}/lines`, { sellable_item_id: ids[KG.name], quantity: '0.0001' }), 400);
  await posPost(tienda, `${sales()}/${saleId}/void`);
});

test('celular 390×844: venta vacía no se cobra; anular una línea recalcula el total; la registrada queda de solo lectura', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: authFile(TIENDA), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('/tienda-demo/app/ventas');
  await ticket(page).getByRole('button', { name: 'Nueva venta' }).click();
  await expect(page).toHaveURL(/venta=/);
  const saleId = saleIdOf(page)!;
  await expect(ticket(page).getByRole('button', { name: /^Cobrar/ })).toBeDisabled();
  await expectError(await pos(tienda, `${sales()}/${saleId}/complete`, { payment_method: 'cash' }), 409, 'empty_sale');

  await tap(page, UNIT.name, '2');
  await expect(ticket(page).getByRole('listitem').filter({ hasText: UNIT.name })).toContainText('2 unidades');
  await tap(page, CHEAP.name, '1');
  await expect(ticket(page).getByRole('button', { name: /^Cobrar .*25\.000/ })).toBeVisible();
  await ticket(page).getByRole('button', { name: `Anular ${UNIT.name}` }).click();
  await expect(page.getByText(`${UNIT.name} anulado de la venta.`)).toBeVisible();
  await expect(ticket(page).getByRole('listitem').filter({ hasText: UNIT.name })).toContainText('Anulada');
  await ticket(page).getByLabel('Medio de pago').selectOption({ label: 'Efectivo' });
  await ticket(page).getByRole('button', { name: /^Cobrar .*5\.000/ }).click();
  await expect(page.getByText('Venta registrada (cobro declarado): ')).toContainText('5.000 en efectivo');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  // Registrada: ni agregar, ni anular líneas, ni anularla, ni cobrarla otra vez.
  const sale = await json(tienda, 'GET', `${sales()}/${saleId}`);
  expect([sale.status, sale.total, sale.lines.filter((l: any) => l.voided_at).length]).toEqual(['completed', '5000.00', 1]);
  const live = sale.lines.find((l: any) => !l.voided_at).id;
  for (const [path, body] of [
    [`${saleId}/lines`, { sellable_item_id: ids[CHEAP.name], quantity: '1' }], [`${saleId}/lines/${live}/void`, undefined],
    [`${saleId}/void`, undefined], [`${saleId}/complete`, { payment_method: 'card' }],
  ] as const) await expectError(await pos(tienda, `${sales()}/${path}`, body), 409, 'sale_not_open');

  // En la UI tampoco: el enlace a la venta cobrada no la abre en el ticket, y el detalle del historial no tiene acciones.
  await page.goto(`/tienda-demo/app/ventas?venta=${saleId}`);
  await expect(page).not.toHaveURL(/venta=/);
  await expect(ticket(page).getByRole('button', { name: /^Cobrar/ })).toHaveCount(0);
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Historial' }).click();
  await page.getByRole('main').getByRole('listitem').first().getByRole('button').click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText(`${UNIT.name}`);
  await expect(detail).toContainText('Anulada');
  await expect(detail.getByRole('button')).toHaveText(['Cerrar']);
  await ctx.close();
});

test('catálogo: nombre o SKU de un artículo activo no se repite; desactivado no se vende y libera el nombre', async ({ browser }) => {
  const name = `E2E Borde Dup ${run}`;
  const sku = `E2E-DUP-${run}`;
  ids.dup = (await json(tienda, 'POST', `/locations/${loc}/pos/items`, { name, sku, unit: 'unit', price: '1000' })).id;
  const page = await pageAs(browser, TIENDA);
  await page.goto('/tienda-demo/app/ventas');
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Catálogo' }).click();
  await page.getByRole('button', { name: 'Nuevo artículo' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo artículo' });
  await dialog.getByLabel('Nombre').fill(name);
  await dialog.getByLabel(/^Precio/).fill('1000');
  await dialog.getByRole('button', { name: 'Crear artículo' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ya existe un artículo activo con ese nombre o SKU.');
  await dialog.getByLabel('Nombre').fill(`${name} otro`);
  await dialog.getByLabel('SKU').fill(sku);
  await dialog.getByRole('button', { name: 'Crear artículo' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Ya existe un artículo activo con ese nombre o SKU.');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: `Desactivar ${name}` }).click();
  await page.getByRole('dialog', { name: `Desactivar ${name}` }).getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: sku })).toContainText('Inactivo');

  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Vender' }).click();
  await page.getByLabel('Buscar').fill(name);
  await expect(page.getByText(`Nada coincide con «${name}».`)).toBeVisible();
  const { sale } = await posPost(tienda, sales());
  await expectError(await pos(tienda, `${sales()}/${sale.id}/lines`, { sellable_item_id: ids.dup, quantity: '1' }), 409, 'inactive_entity');
  await posPost(tienda, `${sales()}/${sale.id}/void`);

  // Desactivado, el nombre y el SKU quedan libres.
  await json(tienda, 'POST', `/locations/${loc}/pos/items`, { name, sku, unit: 'unit', price: '1000' });
});

test('teclado en «Nuevo artículo»: Tab llega al campo, Enter con error enfoca el campo inválido; Escape cierra y devuelve el foco', async ({ browser }) => {
  const page = await pageAs(browser, TIENDA);
  await page.goto('/tienda-demo/app/ventas');
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Catálogo' }).click();
  const open = page.getByRole('button', { name: 'Nuevo artículo' });
  await open.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Nuevo artículo' });
  const nameField = dialog.getByLabel('Nombre');
  for (let i = 0; i < 6 && !(await nameField.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(nameField).toBeFocused();
  await page.keyboard.press('Enter'); // nombre vacío
  const alert = dialog.getByRole('alert');
  await expect(alert).toHaveText('Escribe el nombre del artículo.');
  await expect(nameField).toBeFocused();
  await expect(nameField).toHaveAttribute('aria-invalid', 'true');
  await expect(nameField).toHaveAttribute('aria-describedby', (await alert.getAttribute('id'))!);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test('Caja (caja1) vende pero no gestiona el catálogo ni anula ventas: sin botón y 403 en la API', async ({ browser }) => {
  const caja = await apiAs(CAJA);
  const { sale } = await posPost(caja, sales(barLoc));
  try {
    await posPost(caja, `${sales(barLoc)}/${sale.id}/lines`, { sellable_item_id: ids.bar, quantity: '1' });
    const page = await pageAs(browser, CAJA);
    await page.goto(`/bar-demo/app/ventas?venta=${sale.id}`);
    await expect(ticket(page).getByRole('button', { name: /^Cobrar .*3\.000/ })).toBeEnabled();
    await expect(ticket(page).getByRole('button', { name: `Anular E2E Borde Agua ${run}` })).toBeVisible(); // anular una línea es operar
    await expect(ticket(page).getByRole('button', { name: 'Anular venta' })).toHaveCount(0);

    const items = `/api/v1/locations/${barLoc}/pos/items`;
    for (const res of [
      await caja.post(items, { data: { name: `E2E Borde nunca ${run}`, unit: 'unit', price: '1' } }),
      await caja.patch(`${items}/${ids.bar}`, { data: { price: '1' } }),
      await caja.post(`${items}/${ids.bar}/deactivate`),
      await caja.put(`/api/v1/locations/${barLoc}/pos/settings`, { data: { currency: 'USD' } }),
      await pos(caja, `${sales(barLoc)}/${sale.id}/void`),
    ]) await expectError(res, 403, 'permission_denied');
  } finally {
    await posPost(bar, `${sales(barLoc)}/${sale.id}/void`);
  }
});

test('mesero1 e inventario1 no ven Ventas, ni en el menú ni por URL; la API de POS responde 403', async ({ browser }) => {
  for (const user of [['bar-demo', 'mesero1'], ['bar-demo', 'inventario1']] as const) {
    const page = await pageAs(browser, user);
    await page.goto('/bar-demo/app/ventas');
    await expect(page).not.toHaveURL(/\/ventas/);
    await expect(page.getByRole('navigation', { name: 'Módulos' }).first().getByRole('link').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Módulos' }).getByRole('link', { name: 'Ventas' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ventas' })).toHaveCount(0);
    const api = await apiAs(user);
    await expectError(await api.get(`/api/v1/locations/${barLoc}/pos/items`), 403, 'permission_denied');
    await expectError(await pos(api, sales(barLoc)), 403, 'permission_denied');
  }
});

test('idempotencia: la misma clave devuelve la misma venta (replayed); con otro cuerpo u otra operación, 409', async () => {
  const open = randomUUID();
  const first = await pos(tienda, sales(), undefined, open);
  expect(first.status()).toBe(201);
  const { sale, replayed } = await first.json();
  expect(replayed).toBe(false);
  const again = await pos(tienda, sales(), undefined, open);
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ sale: { id: sale.id }, replayed: true });

  const add = randomUUID();
  const line = { sellable_item_id: ids[UNIT.name], quantity: '1' };
  expect((await pos(tienda, `${sales()}/${sale.id}/lines`, line, add)).status()).toBe(201);
  const replay = await pos(tienda, `${sales()}/${sale.id}/lines`, line, add);
  expect(replay.status()).toBe(200);
  const body = await replay.json();
  expect([body.replayed, body.sale.lines.length, body.sale.total]).toEqual([true, 1, '10000.00']);
  await expectError(await pos(tienda, `${sales()}/${sale.id}/lines`, { ...line, quantity: '2' }, add), 409, 'idempotency_key_reused');
  await expectError(await pos(tienda, `${sales()}/${sale.id}/lines`, line, open), 409, 'idempotency_key_reused');
  expect((await json(tienda, 'GET', `${sales()}/${sale.id}`)).lines).toHaveLength(1);
  await posPost(tienda, `${sales()}/${sale.id}/void`);
});

test('aislamiento: Tienda Demo no lee ni opera el local de Bar Demo, ni vende un artículo suyo (404)', async () => {
  await expectError(await tienda.get(`/api/v1/locations/${barLoc}/pos/items`), 404);
  await expectError(await tienda.get(`/api/v1${sales(barLoc)}`), 404);
  await expectError(await pos(tienda, sales(barLoc)), 404);
  const { sale } = await posPost(tienda, sales());
  await expectError(await pos(tienda, `${sales()}/${sale.id}/lines`, { sellable_item_id: ids.bar, quantity: '1' }), 404, 'not_found');
  await posPost(tienda, `${sales()}/${sale.id}/void`);
});

test('historial: «Anuladas» filtra por estado y la API pagina con cursor sin repetir', async ({ browser }) => {
  for (let i = 0; i < 3; i++) {
    const { sale } = await posPost(tienda, sales());
    await posPost(tienda, `${sales()}/${sale.id}/lines`, { sellable_item_id: ids[KG.name], quantity: '0.617' }); // 12.340
    await posPost(tienda, `${sales()}/${sale.id}/void`);
  }
  const page = await pageAs(browser, TIENDA);
  await page.goto('/tienda-demo/app/ventas');
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Historial' }).click();
  await page.getByRole('group', { name: 'Estado' }).getByRole('button', { name: 'Anuladas' }).click();
  const first = page.getByRole('main').getByRole('listitem').first();
  await expect(first).toContainText('12.340');
  await first.getByRole('button').click();
  await expect(page.getByRole('dialog')).toContainText('Anulada');

  const p1 = await json<any[]>(tienda, 'GET', `${sales()}?status=voided&limit=2`);
  const last = p1.at(-1);
  const p2 = await json<any[]>(tienda, 'GET', `${sales()}?status=voided&limit=2&cursor=${encodeURIComponent(`${last.opened_at}_${last.id}`)}`);
  expect(p1).toHaveLength(2);
  expect(p2.length).toBeGreaterThan(0);
  expect(p2.some((s) => p1.some((x) => x.id === s.id))).toBe(false);
  expect([...p1, ...p2].every((s) => s.status === 'voided')).toBe(true);
  expect(p2[0].opened_at <= last.opened_at).toBe(true);
  await expectError(await tienda.get(`/api/v1${sales()}?cursor=no-es-un-cursor`), 400);
});

test('moneda: tras cambiarla, un artículo de la moneda anterior no se vende (currency_mismatch); se restaura', async ({ browser }) => {
  const settings = `/locations/${loc}/pos/settings`;
  const { currency } = await json(tienda, 'GET', settings);
  const other = currency === 'USD' ? 'EUR' : 'USD';
  const page = await pageAs(browser, TIENDA);
  try {
    await page.goto('/tienda-demo/app/ventas');
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Catálogo' }).click();
    await page.getByLabel('Moneda (código ISO 4217)').fill(other);
    await page.getByRole('button', { name: 'Guardar moneda' }).click();
    await expect(page.getByText(`Moneda del local: ${other}.`)).toBeVisible();

    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Vender' }).click();
    await tap(page, UNIT.name, '1');
    await expect(page.getByRole('alert')).toHaveText('Ese artículo tiene otra moneda que la venta. Revisa la moneda del local en Catálogo.');
    await expect(page).toHaveURL(/venta=/);
    const saleId = saleIdOf(page)!;
    const sale = await json(tienda, 'GET', `${sales()}/${saleId}`);
    expect([sale.currency, sale.lines.length]).toEqual([other, 0]);
    await expectError(await pos(tienda, `${sales()}/${saleId}/lines`, { sellable_item_id: ids[UNIT.name], quantity: '1' }), 409, 'currency_mismatch');
    await posPost(tienda, `${sales()}/${saleId}/void`);
  } finally {
    await json(tienda, 'PUT', settings, { currency });
  }
  expect((await json(tienda, 'GET', settings)).currency).toBe(currency);
});
