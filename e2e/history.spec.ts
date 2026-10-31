import { expect, test } from '@playwright/test';
import { apiAs, closeActiveCalls, json, locationOf, press, tableId } from './support/api';
import { authFile } from './support/env';

// F3-14 y F3-16 «→ historial»: un llamado tomado y cerrado por «Barra» aparece en el historial con quién lo tomó y cerró, y su detalle
// muestra la línea de tiempo. El llamado queda cerrado, así que no hay nada que limpiar.

test.use({ storageState: authFile(['bar-demo', 'admin']) });

test('el historial muestra quién tomó y cerró un llamado y abre su línea de tiempo', async ({ page }) => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const barra = await apiAs(['bar-demo', 'barra']);
  const loc = await locationOf(admin);
  await closeActiveCalls(admin, loc, await tableId(admin, loc, 'Mesa 9'));

  const { result, service_call_id } = await press('bar-demo', 'btn-09');
  expect(result).toBe('call_created');
  await json(barra, 'POST', `/locations/${loc}/service-calls/${service_call_id}/acknowledge`);
  await json(barra, 'POST', `/locations/${loc}/service-calls/${service_call_id}/complete`);

  await page.goto('/bar-demo/app/historial');
  await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
  await page.getByRole('group', { name: 'Atajos de fecha' }).getByRole('button', { name: 'Hoy' }).click();
  const row = page.getByRole('button', { name: /^Mesa 9, .*Tomó Barra, cerró Barra/ }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('Atendida');

  await row.click();
  const detail = page.getByRole('dialog', { name: 'Detalle de Mesa 9' });
  const timeline = detail.getByRole('region', { name: 'Línea de tiempo' });
  await expect(timeline.getByText('Llegó el llamado')).toBeVisible();
  await expect(timeline.getByText('Pasó a «En atención»')).toBeVisible();
  await expect(timeline.getByText('Finalizado')).toBeVisible();
  await expect(timeline.getByText(/Barra/).first()).toBeVisible();
  await detail.getByRole('button', { name: 'Cerrar' }).click();
  await expect(detail).toBeHidden();
});
