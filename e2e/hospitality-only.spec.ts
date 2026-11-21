import { expect, test, type Page } from '@playwright/test';
import { pageAs } from './pages';
import { apiAs, locationOf } from './support/api';

// MOD-74 (PLAN-003 T07): restaurante con Core + Hospitality solamente, en la misma instalación que la zapatería.
// Ve tablero y espacios; no ve inventario ni métricas, y el portal no consulta commerce ni analytics.

const FOREIGN = /\/(products|stock|stock-locations|movement-reasons|metrics)\b/;
const watch = (page: Page) => {
  const urls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) urls.push(r.url()); });
  return urls;
};

test('restaurante: tablero y espacios sin inventario ni métricas', async ({ browser }) => {
  const page = await pageAs(browser, ['restaurante-demo', 'admin']);
  const urls = watch(page);
  await page.goto('/restaurante-demo/app');
  await expect(page).toHaveURL('/restaurante-demo/app/tablero');
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Módulos' }).first();
  await expect(nav.getByRole('link')).toHaveText(['Tablero', 'Historial', 'Espacios', 'Usuarios']);

  await page.goto('/restaurante-demo/app/espacios');
  await expect(page).toHaveURL('/restaurante-demo/app/espacios');
  for (const screen of ['inventario', 'metricas']) {
    await page.goto(`/restaurante-demo/app/${screen}`);
    await expect(page).toHaveURL('/restaurante-demo/app/tablero');
  }
  expect(urls.filter((u) => FOREIGN.test(u))).toEqual([]);

  const api = await apiAs(['restaurante-demo', 'admin']);
  const loc = await locationOf(api);
  expect((await api.get(`/api/v1/locations/${loc}/products`)).status()).toBe(403);
});
