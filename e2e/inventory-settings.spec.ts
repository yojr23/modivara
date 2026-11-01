import { expect, test } from '@playwright/test';
import { authFile } from './support/env';

// F4-10: el admin asegura el lugar «E2E lugar» (la API no permite borrarlo: se crea solo si no existe, para no llenar la demo)
// y crea un motivo «E2E …», lo ve en el registro rápido, lo desactiva y comprueba que ya no se ofrece.

test.use({ storageState: authFile(['bar-demo', 'admin']) });

test('crear lugar y motivo, usarlo en el registro y desactivarlo', async ({ page }) => {
  const id = Date.now().toString(36);
  const place = 'E2E lugar';
  const reason = `E2E motivo ${id}`;
  await page.goto('/bar-demo/app/inventario');
  const view = page.getByRole('group', { name: 'Vista' });
  const motivo = page.getByRole('combobox', { name: 'Motivo' });

  await view.getByRole('button', { name: 'Lugares y motivos' }).click();
  const places = page.getByRole('region', { name: 'Lugares de stock' });
  await expect(places.getByRole('listitem').first()).toBeVisible(); // lista cargada (siempre existe el lugar por defecto)
  if (await places.getByText(place, { exact: true }).count() === 0) {
    await page.getByLabel('Nombre del lugar').fill(place);
    await page.getByRole('button', { name: 'Agregar lugar' }).click();
  }
  await expect(places.getByText(place, { exact: true })).toBeVisible();

  await page.getByLabel('Nombre del motivo').fill(reason);
  await page.getByLabel('Tipo').selectOption('out');
  await page.getByRole('button', { name: 'Agregar motivo' }).click();
  await expect(page.getByRole('group', { name: 'Salida' }).getByText(reason, { exact: true })).toBeVisible();

  await view.getByRole('button', { name: 'Registro' }).click();
  await expect(motivo.getByRole('option', { name: reason })).toBeAttached();

  await view.getByRole('button', { name: 'Lugares y motivos' }).click();
  await page.getByRole('button', { name: `Desactivar ${reason}` }).click();
  await page.getByRole('dialog', { name: `Desactivar motivo ${reason}` }).getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByRole('group', { name: 'Salida' }).getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Desactivar ${reason}` })).toHaveCount(0);

  await view.getByRole('button', { name: 'Registro' }).click();
  await expect(motivo).toBeVisible();
  await expect(motivo.getByRole('option', { name: reason })).toHaveCount(0);
});
