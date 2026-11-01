import { expect, test } from '@playwright/test';
import { authFile } from './support/env';

// F2-15 / F3-15: el superadmin entra por /labs, elige Bar Demo / Principal, crea un gateway «E2E consola …», lo ve y lo desactiva;
// asigna y desasigna un botón de prueba (la API no borra botones: se reutiliza el código fijo `btn-e2e-consola`).
// Un admin del negocio no ve la consola.

const BUTTON = 'btn-e2e-consola';

test.describe('superadmin', () => {
  test.use({ storageState: authFile(['labs', 'superadmin']) });

  test('gateway: crear (clave una vez) y desactivar; botón: asignar y desasignar', async ({ page }) => {
    const gateway = `E2E consola ${Date.now().toString(36)}`;
    await page.goto('/labs/app/consola');
    await expect(page.getByRole('heading', { name: 'Consola' })).toBeVisible();
    await page.getByLabel('Negocio').selectOption({ label: 'Bar Demo' });
    await expect(page.getByRole('status').filter({ hasText: 'Estás actuando en Bar Demo' })).toBeVisible();
    await page.getByLabel('Local').selectOption({ label: 'Principal' });

    // Gateways
    await page.getByLabel('Nombre del gateway').fill(gateway);
    await page.getByRole('button', { name: 'Crear gateway' }).click();
    const key = page.getByRole('region', { name: `Clave de ${gateway}` });
    await expect(key.getByRole('note')).toContainText('única vez');
    await expect(key.locator('code')).toHaveText(/\S{32,}/);
    await key.getByRole('button', { name: 'Ya la guardé' }).click();
    await expect(key).toBeHidden();
    const item = page.getByRole('list', { name: 'Gateways' }).getByRole('listitem').filter({ hasText: gateway });
    await expect(item).toBeVisible();
    await page.getByRole('button', { name: `Desactivar ${gateway}` }).click();
    await page.getByRole('dialog', { name: `Desactivar gateway ${gateway}` }).getByRole('button', { name: 'Desactivar' }).click();
    await expect(item).toHaveCount(0);

    // Botones
    await page.getByRole('group', { name: 'Sección' }).getByRole('button', { name: 'Botones' }).click();
    const list = page.getByRole('list', { name: 'Botones' });
    await expect(list.getByRole('listitem').first()).toBeVisible();
    const row = list.getByRole('listitem').filter({ hasText: BUTTON });
    if (await row.count() === 0) {
      await page.getByLabel('Código del botón').fill(BUTTON);
      await page.getByRole('button', { name: 'Crear botón' }).click();
    }
    await expect(row).toBeVisible();
    if (await row.getByRole('button', { name: `Desasignar ${BUTTON}` }).count()) { // resto de una corrida interrumpida
      await row.getByRole('button', { name: `Desasignar ${BUTTON}` }).click();
    }
    await row.getByLabel(`Mesa de ${BUTTON}`).selectOption({ index: 1 });
    await row.getByRole('button', { name: `Asignar ${BUTTON}` }).click();
    await expect(row.getByText('Mesa:')).toBeVisible();
    await row.getByRole('button', { name: `Desasignar ${BUTTON}` }).click();
    await expect(row.getByText('Sin asignar')).toBeVisible();

    // Detectados sin asignar
    await page.getByRole('group', { name: 'Sección' }).getByRole('button', { name: 'Detectados sin asignar' }).click();
    await expect(page.getByText('Códigos que pulsaron sin estar registrados')).toBeVisible();

    await page.getByRole('button', { name: 'Dejar de actuar' }).click();
    await expect(page.getByLabel('Negocio')).toHaveValue('');
    await expect(page.getByRole('group', { name: 'Sección' })).toHaveCount(0);
  });
});

test.describe('admin del negocio', () => {
  test.use({ storageState: authFile(['bar-demo', 'admin']) });

  test('no ve la consola ni entra por URL directa', async ({ page }) => {
    await page.goto('/bar-demo/app/consola');
    await expect(page).not.toHaveURL(/consola/);
    await expect(page.getByRole('link', { name: 'Consola' })).toHaveCount(0);
  });
});
