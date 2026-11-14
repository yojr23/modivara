import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { InventoryPage, pageAs } from './pages';
import { apiAs, json, locationOf } from './support/api';
import type { User } from './support/env';

// Casos borde de Inventario que no cubren inventory.spec ni inventory-settings.spec: salida rechazada por el servidor cuando
// otro equipo gastó el saldo, conteo igual al saldo, permisos de inventario1, producto desactivado, idempotencia de movimientos
// y local de otro negocio. Los productos «E2E Borde …» se desactivan al final; sus movimientos quedan en el historial.

const INV: User = ['bar-demo', 'inventario1'];
const run = Date.now() % 1e6;

let api: APIRequestContext;
let loc: string;
let place: string;
const reason: Record<'in' | 'out' | 'adjust', string> = { in: '', out: '', adjust: '' };

async function expectError(res: APIResponse, status: number, code?: string) {
  expect(res.status(), await res.text()).toBe(status);
  if (code) expect((await res.json()).code).toBe(code);
}
const move = (ctx: APIRequestContext, data: unknown, key: string = randomUUID(), path = 'stock/movements') =>
  ctx.post(`/api/v1/locations/${loc}/${path}`, { data, headers: { 'idempotency-key': key } });
const balance = async (productId: string) => (await json<any[]>(api, 'GET', `/locations/${loc}/stock/balances?product_id=${productId}`))[0]?.quantity;

/** Producto «E2E Borde …» con stock inicial. */
async function product(label: string, initial = '5') {
  const p = await json(api, 'POST', `/locations/${loc}/products`, { name: `E2E Borde ${label} ${run}`, unit: 'bottle' });
  await move(api, { stock_location_id: place, product_id: p.id, direction: 'in', reason_id: reason.in, quantity: initial });
  return p as { id: string; name: string };
}

test.beforeAll(async () => {
  api = await apiAs(INV);
  loc = await locationOf(api);
  place = (await json<any[]>(api, 'GET', `/locations/${loc}/stock-locations`)).find((p) => p.is_default).id;
  const reasons = await json<any[]>(api, 'GET', '/commerce/movement-reasons');
  reason.in = reasons.find((r) => r.active && r.name === 'Compra').id;
  reason.out = reasons.find((r) => r.active && r.name === 'Venta').id;
  reason.adjust = reasons.find((r) => r.active && r.direction === 'adjust').id;
});

test.afterAll(async () => {
  for (const p of await json<any[]>(api, 'GET', `/locations/${loc}/products`)) {
    if (p.active && p.name.endsWith(` ${run}`)) await json(api, 'POST', `/locations/${loc}/products/${p.id}/deactivate`);
  }
});

test('salida que otro equipo dejó sin saldo: el servidor la rechaza y el saldo no cambia; conteo igual al saldo, rechazado', async ({ browser }) => {
  const p = await product('Gin');
  const inv = new InventoryPage(await pageAs(browser, INV));
  await inv.goto();
  await inv.product(p.name).click();
  await expect(inv.product(p.name)).toContainText('5 botellas');

  // Otro equipo saca 4 mientras esta pantalla aún cree que hay 5.
  expect((await move(api, { stock_location_id: place, product_id: p.id, direction: 'out', reason_id: reason.out, quantity: '4' })).status()).toBe(201);
  await inv.type('Salida').click();
  await inv.register('3', 'Registrar salida', 'Venta');
  await expect(inv.page.getByRole('alert')).toHaveText(`No alcanza el saldo de ${p.name}: alguien registró una salida antes. Revisa el saldo y vuelve a intentar.`);
  await expectError(await move(api, { stock_location_id: place, product_id: p.id, direction: 'out', reason_id: reason.out, quantity: '2' }), 409, 'insufficient_stock');
  expect(await balance(p.id)).toBe('1.000');
  expect(await json<any[]>(api, 'GET', `/locations/${loc}/stock/movements?product_id=${p.id}`)).toHaveLength(2);

  // Con el saldo al día, contar lo mismo que hay no es un ajuste.
  await inv.goto();
  await inv.product(p.name).click();
  await expect(inv.product(p.name)).toContainText('1 botella');
  await inv.type('Ajuste por conteo').click();
  await inv.register('1', /^Ajustar a 1 botella/);
  await expect(inv.page.getByRole('alert')).toHaveText('El conteo coincide con el saldo (1 botella): no hay nada que ajustar.');
  await expectError(await move(api, { stock_location_id: place, product_id: p.id, reason_id: reason.adjust, counted_quantity: '1' }, randomUUID(), 'stock/count-adjustments'), 400, 'invalid_movement');
  expect(await balance(p.id)).toBe('1.000');
});

test('inventario1 registra y gestiona productos, pero no motivos: «Lugares de stock» sin motivos y 403 en la API', async ({ browser }) => {
  const inv = new InventoryPage(await pageAs(browser, INV));
  await inv.goto();
  await expect(inv.page.getByRole('group', { name: 'Vista' }).getByRole('button')).toHaveText(['Registro', 'Lugares de stock']);
  await expect(inv.page.getByRole('button', { name: 'Nuevo producto' })).toBeVisible();
  await expect(inv.page.getByRole('group', { name: 'Tipo de movimiento' })).toBeVisible();
  await expectError(await api.post('/api/v1/commerce/movement-reasons', { data: { name: `E2E Borde motivo ${run}`, direction: 'out' } }), 403, 'permission_denied');
  await expectError(await api.post(`/api/v1/commerce/movement-reasons/${reason.out}/deactivate`), 403, 'permission_denied');

  // Y el personal de sala (staff) ni siquiera lee el inventario.
  const mesero = await apiAs(['bar-demo', 'mesero1']);
  await expectError(await mesero.get(`/api/v1/locations/${loc}/products`), 403, 'permission_denied');
  await expectError(await move(mesero, { stock_location_id: place, product_id: randomUUID(), direction: 'in', reason_id: reason.in, quantity: '1' }), 403, 'permission_denied');
});

test('un producto desactivado sale del registro y la API no le acepta movimientos', async ({ browser }) => {
  const p = await product('Vermut');
  await json(api, 'POST', `/locations/${loc}/products/${p.id}/deactivate`);
  const inv = new InventoryPage(await pageAs(browser, INV));
  await inv.goto();
  await expect(inv.page.getByRole('group', { name: 'Tipo de movimiento' })).toBeVisible();
  await expect(inv.product(p.name)).toHaveCount(0);
  await expectError(await move(api, { stock_location_id: place, product_id: p.id, direction: 'in', reason_id: reason.in, quantity: '1' }), 409, 'inactive_entity');
});

test('idempotencia: la misma clave devuelve el mismo movimiento (replayed) y suma una vez; con otro cuerpo, 409', async () => {
  const p = await product('Tequila', '2');
  const key = randomUUID();
  const body = { stock_location_id: place, product_id: p.id, direction: 'in', reason_id: reason.in, quantity: '3' };
  const first = await move(api, body, key);
  expect(first.status()).toBe(201);
  const { movement } = await first.json();
  const again = await move(api, body, key);
  expect(again.status()).toBe(200);
  expect(await again.json()).toMatchObject({ movement: { id: movement.id, balance_after: '5.000' }, replayed: true });
  await expectError(await move(api, { ...body, quantity: '4' }, key), 409, 'idempotency_key_reused');
  expect(await balance(p.id)).toBe('5.000');

  const adjust = { stock_location_id: place, product_id: p.id, reason_id: reason.adjust, counted_quantity: '4' };
  const adjKey = randomUUID();
  expect((await move(api, adjust, adjKey, 'stock/count-adjustments')).status()).toBe(201);
  expect((await move(api, adjust, adjKey, 'stock/count-adjustments')).status()).toBe(200);
  expect(await balance(p.id)).toBe('4.000');
});

test('el local de Bar Demo no existe para otro negocio (Bar Demo Pisos): 404 al leer y al registrar', async () => {
  const p = await product('Pisco', '1');
  const pisos = await apiAs(['bar-demo-pisos', 'admin']);
  for (const path of ['products', 'stock-locations', `stock/balances?product_id=${p.id}`, 'stock/movements']) {
    await expectError(await pisos.get(`/api/v1/locations/${loc}/${path}`), 404, 'not_found');
  }
  await expectError(await move(pisos, { stock_location_id: place, product_id: p.id, direction: 'out', reason_id: reason.out, quantity: '1' }), 404, 'not_found');
  await expectError(await pisos.post(`/api/v1/locations/${loc}/products/${p.id}/deactivate`), 404, 'not_found');
  expect(await balance(p.id)).toBe('1.000');
});
