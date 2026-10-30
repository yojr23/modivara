import { expect, test } from '@playwright/test';
import { apiAs, callsSince, closeActiveCalls, json, locationOf, press, tableId } from './support/api';
import { authFile } from './support/env';

// F5-13: lo que muestran las métricas coincide con la fuente. Se crean llamados nuevos (pulsación + reconocer + finalizar) y el total
// de «Hoy» en la pantalla debe igualar al historial de llamados; el saldo de un producto, al de inventario.

test.use({ storageState: authFile(['bar-demo', 'admin']) });

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0)); // el navegador y el local están en America/Bogota

test('llamados de hoy: la pantalla de métricas coincide con el historial', async ({ page }) => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  for (const [label, code] of [['Mesa 11', 'btn-11'], ['Mesa 12', 'btn-12']] as const) {
    const table = await tableId(admin, loc, label);
    await closeActiveCalls(admin, loc, table);
    expect((await press('bar-demo', code)).result).toBe('call_created');
    await closeActiveCalls(admin, loc, table);
  }

  // analytics recibe los eventos por el outbox (asíncrono): esperar a que la proyección alcance a la fuente.
  const expected = (await callsSince(admin, loc, startOfToday())).length;
  await expect.poll(async () => (await json(admin, 'GET', `/locations/${loc}/metrics/service-calls?range=today`)).totals.calls, { timeout: 20_000 }).toBe(expected);

  await page.goto('/bar-demo/app/metricas');
  await page.getByRole('group', { name: 'Período' }).getByRole('button', { name: 'Hoy' }).click();
  await expect(page.getByRole('group', { name: 'Llamados', exact: true })).toContainText(String(expected));
});

test('inventario en métricas: el saldo de un producto coincide con el de inventario', async ({ page }) => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  const agua = (await json<any[]>(admin, 'GET', `/locations/${loc}/products`)).find((p) => p.name === 'Agua');
  const [balance] = await json<any[]>(admin, 'GET', `/locations/${loc}/stock/balances?product_id=${agua.id}`);
  const shown = `${Number(balance.quantity)} botellas`;

  await page.goto('/bar-demo/app/metricas?tab=stock');
  await page.getByRole('button', { name: /^Agua:/ }).click();
  await expect(page.getByRole('group', { name: 'Saldo actual' })).toContainText(shown);
});
