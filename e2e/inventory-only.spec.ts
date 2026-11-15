import { expect, test, type Page } from '@playwright/test';
import { pageAs } from './pages';
import { apiAs, json, locationOf } from './support/api';

// MOD-61 / MOD-74 (PLAN-003 T01): zapatería con Core + Commerce solamente. Alta del SKU ZAP-NEG-40 en unidades, 15 de entrada,
// 2 salidas de 1, saldo 13 e historial; navegación solo de inventario; URL forzadas vuelven; nada pide mesas, llamados ni métricas.

const SKU = 'ZAP-NEG-40';
const FOREIGN = /\/(zones|tables|layouts|service-calls|device-status|gateways|devices|metrics)\b|\/socket\.io/;

/** Registra cada URL de la API que pide la página, para afirmar qué productos NO se consultaron. */
const watch = (page: Page) => {
  const urls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/') || r.url().includes('/socket.io')) urls.push(r.url()); });
  return urls;
};

test('zapatería: entrada de 15, dos salidas de 1, saldo 13 e historial, sin consultas de mesas ni métricas', async ({ browser }) => {
  const api = await apiAs(['zapateria-demo', 'inventario1']);
  const loc = await locationOf(api);
  // Repetible: el SKU es único entre productos activos, así que se desactiva el de una corrida anterior.
  for (const p of await json<any[]>(api, 'GET', `/locations/${loc}/products`)) {
    if (p.sku === SKU && p.active) await json(api, 'POST', `/locations/${loc}/products/${p.id}/deactivate`);
  }

  const page = await pageAs(browser, ['zapateria-demo', 'inventario1']);
  const urls = watch(page);
  await page.goto('/zapateria-demo/app');
  await expect(page).toHaveURL('/zapateria-demo/app/inventario');
  const name = `Zapato negro 40 E2E ${Date.now() % 1e6}`;

  await page.getByRole('button', { name: /Nuevo producto|Crear el primer producto/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' });
  await dialog.getByLabel('Nombre').fill(name);
  await expect(dialog.getByLabel('Unidad')).toHaveValue('unit'); // MOD-60: por defecto «Unidades», no botellas
  await dialog.getByLabel('SKU (opcional)').fill(SKU);
  await dialog.getByRole('button', { name: 'Crear producto' }).click();
  await expect(dialog).toBeHidden();

  const quantity = page.getByRole('textbox', { name: /^Cantidad/ });
  await quantity.fill('15');
  await page.getByRole('combobox', { name: 'Motivo' }).selectOption({ label: 'Compra' });
  await page.getByRole('button', { name: 'Registrar entrada' }).click();
  await expect(page.getByText(`Entrada registrada: +15 unidades de ${name}. Saldo: 15 unidades`)).toBeVisible();

  await page.getByRole('group', { name: 'Tipo de movimiento' }).getByRole('button', { name: 'Salida' }).click();
  for (const left of [14, 13]) {
    await quantity.fill('1');
    await page.getByRole('combobox', { name: 'Motivo' }).selectOption({ label: 'Venta' });
    await page.getByRole('button', { name: 'Registrar salida' }).click();
    await expect(page.getByText(`Salida registrada: −1 unidad de ${name}. Saldo: ${left} unidades`)).toBeVisible();
  }

  const today = page.getByRole('complementary', { name: 'Hoy' }).getByRole('listitem').filter({ hasText: name });
  await expect(today).toHaveCount(3);
  await expect(today.first()).toContainText('Saldo 13 unidades');
  await page.getByRole('button', { name: 'Ver historial' }).click();
  const hist = page.getByRole('complementary', { name: 'Historial' });
  await hist.getByRole('combobox', { name: 'Producto' }).selectOption({ label: name });
  await expect(hist.getByRole('listitem')).toHaveCount(3);

  // La API dice lo mismo; hospitality y analytics no están contratados: 403 aunque se pidan a mano.
  const product = (await json<any[]>(api, 'GET', `/locations/${loc}/products`)).find((p) => p.name === name);
  expect(product).toMatchObject({ sku: SKU, unit: 'unit' });
  const moves = await json<any[]>(api, 'GET', `/locations/${loc}/stock/movements?product_id=${product.id}`);
  expect(moves.map((m) => [m.direction, m.delta, m.balance_after])).toEqual([['out', '-1.000', '13.000'], ['out', '-1.000', '14.000'], ['in', '15.000', '15.000']]);
  expect((await api.get(`/api/v1/locations/${loc}/tables`)).status()).toBe(403);
  expect((await api.get(`/api/v1/locations/${loc}/metrics/inventory`)).status()).toBe(403);

  expect(urls.filter((u) => FOREIGN.test(u))).toEqual([]);
  await json(api, 'POST', `/locations/${loc}/products/${product.id}/deactivate`);
});

test('zapatería: el menú solo muestra Inventario y Usuarios, y las URL de otros productos vuelven al inicio', async ({ browser }) => {
  const page = await pageAs(browser, ['zapateria-demo', 'admin']);
  const urls = watch(page);
  await page.goto('/zapateria-demo/app');
  await expect(page).toHaveURL('/zapateria-demo/app/inventario');
  const nav = page.getByRole('navigation', { name: 'Módulos' }).first();
  await expect(nav.getByRole('link')).toHaveText(['Inventario', 'Usuarios']);

  for (const screen of ['tablero', 'historial', 'espacios', 'metricas', 'consola']) {
    await page.goto(`/zapateria-demo/app/${screen}`);
    await expect(page).toHaveURL('/zapateria-demo/app/inventario');
  }
  expect(urls.filter((u) => FOREIGN.test(u))).toEqual([]);
});
