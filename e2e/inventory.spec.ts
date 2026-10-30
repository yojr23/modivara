import { expect, test } from '@playwright/test';
import { InventoryPage, pageAs } from './pages';
import { apiAs, json, locationOf } from './support/api';
import { authFile } from './support/env';

// F4-11: inventario1 da de alta un producto, registra entrada, salida y ajuste por conteo; el saldo y el historial coinciden con
// la API; una salida mayor que el saldo se explica; el personal de barra (staff) no ve inventario.

test.describe('inventario', () => {
  test.use({ storageState: authFile(['bar-demo', 'inventario1']) });

  test('alta de producto, entrada, salida y ajuste por conteo dejan saldo e historial coherentes', async ({ page }) => {
    const name = `E2E Ron ${Date.now() % 1e6}`;
    const inv = new InventoryPage(page);
    await inv.goto();

    await inv.createProduct(name);
    await expect(inv.type('Entrada')).toHaveAttribute('aria-pressed', 'true'); // tras crear, toca su stock inicial
    await inv.register('10', 'Registrar entrada');
    await expect(page.getByText(`Entrada registrada: +10 botellas de ${name}. Saldo: 10 botellas`)).toBeVisible();

    await inv.type('Salida').click();
    await inv.register('25', 'Registrar salida');
    await expect(page.getByRole('alert')).toContainText(`No alcanza: hay 10 botellas de ${name}`);
    await inv.register('3', 'Registrar salida');
    await expect(page.getByText(`Salida registrada: −3 botellas de ${name}. Saldo: 7 botellas`)).toBeVisible();

    await inv.type('Ajuste por conteo').click();
    await inv.register('6', 'Ajustar a 6 botellas');
    await expect(page.getByText(`${name} ajustado a 6 botellas (−1 botella)`)).toBeVisible();
    await expect(inv.product(name)).toContainText('6 botellas');

    // Historial del día: los tres movimientos, el último con el saldo final.
    const rows = inv.today().getByRole('listitem').filter({ hasText: name });
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Saldo 6 botellas');

    // La API dice lo mismo que la pantalla.
    const api = await apiAs(['bar-demo', 'inventario1']);
    const loc = await locationOf(api);
    const product = (await json<any[]>(api, 'GET', `/locations/${loc}/products`)).find((p) => p.name === name);
    const balances = await json<any[]>(api, 'GET', `/locations/${loc}/stock/balances?product_id=${product.id}`);
    expect(balances.map((b) => b.quantity)).toEqual(['6.000']);
    const moves = await json<any[]>(api, 'GET', `/locations/${loc}/stock/movements?product_id=${product.id}`);
    expect(moves.map((m) => [m.direction, m.delta, m.balance_after])).toEqual([['adjust', '-1.000', '6.000'], ['out', '-3.000', '7.000'], ['in', '10.000', '10.000']]);

    await json(api, 'POST', `/locations/${loc}/products/${product.id}/deactivate`);
  });
});

test('el personal de barra no ve inventario, ni en el menú ni por URL', async ({ browser }) => {
  const page = await pageAs(browser, ['bar-demo', 'barra']);
  await page.goto('/bar-demo/app/inventario');
  await expect(page).toHaveURL('/bar-demo/app/tablero');
  await expect(page.getByRole('navigation', { name: 'Módulos' }).getByRole('link', { name: 'Inventario' })).toHaveCount(0);
});
