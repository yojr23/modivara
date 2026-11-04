import { expect, test } from '@playwright/test';
import { BoardPage } from './pages';
import { apiAs, json, locationOf } from './support/api';
import { authFile } from './support/env';

// MOD-05: un gateway que nunca dio señal aparece en el tablero con su nombre y qué revisar; al desactivarlo, deja de aparecer.
// Lo crea el superadmin por la API (como en la consola) y lo desactiva al final para no dejar rastro en la demo.

test.use({ storageState: authFile(['bar-demo', 'admin']) });

test('el tablero avisa qué gateway no da señal', async ({ page }) => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const root = await apiAs(['labs', 'superadmin']);
  const org = (await json(admin, 'GET', '/me')).organization.id;
  const loc = await locationOf(admin);
  const name = `E2E sin señal ${Date.now().toString(36)}`;

  await json(root, 'PUT', '/platform/acting-organization', { organization_id: org });
  const gw = await json<{ id: string }>(root, 'POST', `/platform/locations/${loc}/gateways`, { name });
  try {
    const board = new BoardPage(page);
    await board.goto('bar-demo');
    const alert = page.getByRole('status').filter({ hasText: 'Sin señal de botones' });
    await expect(alert).toContainText(name);
    await expect(alert.getByRole('listitem').filter({ hasText: name })).toContainText('aún no ha enviado señal');
  } finally {
    await json(root, 'POST', `/platform/locations/${loc}/gateways/${gw.id}/deactivate`);
    await json(root, 'PUT', '/platform/acting-organization', { organization_id: null });
  }
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
});
