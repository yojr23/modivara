import { expect, test } from '@playwright/test';
import { apiAs, json } from './support/api';
import { authFile } from './support/env';

// F1-15: el admin crea un usuario «E2E …» con local y rol, lo ve en la lista, le cambia el rol y lo desactiva (con lo que queda limpio).
// No se inicia sesión con el usuario creado (cuidado con el límite de logins).

test.use({ storageState: authFile(['bar-demo', 'admin']) });

test('crear, cambiar rol y desactivar un usuario', async ({ page }) => {
  const username = `e2e.${Date.now().toString(36)}`;
  const display = `E2E ${username}`;
  const admin = await apiAs(['bar-demo', 'admin']);
  try {
    await page.goto('/bar-demo/app/usuarios');
    await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();

    await page.getByRole('button', { name: 'Nuevo usuario' }).click();
    const form = page.getByRole('dialog', { name: 'Nuevo usuario' });
    await form.getByLabel('Nombre visible').fill(display);
    await form.getByLabel('Usuario', { exact: true }).fill(username);
    await form.getByLabel('Clave inicial').fill('Clave1234');
    await form.getByRole('checkbox', { name: 'Personal' }).check();
    await form.getByRole('button', { name: 'Crear usuario' }).click();
    await expect(form).toBeHidden();

    await page.getByRole('searchbox', { name: 'Buscar' }).fill(username);
    await expect(page.getByText(display)).toBeVisible();
    await page.getByRole('button', { name: `Gestionar ${display}` }).click();

    const roles = page.getByRole('region', { name: 'Roles' });
    await roles.getByRole('checkbox', { name: 'Inventario' }).check();
    await roles.getByRole('button', { name: 'Guardar roles' }).click();
    await expect(page.getByText('Roles guardados.')).toBeVisible();

    await page.getByRole('button', { name: 'Desactivar usuario' }).click();
    await page.getByRole('dialog', { name: `Desactivar a ${display}` }).getByRole('button', { name: 'Desactivar' }).click();
    await expect(page.getByText('desactivado.')).toBeVisible();
    await expect(page.getByText('Nadie coincide')).toBeVisible();
  } finally {
    const { users } = await json<{ users: { id: string; username: string }[] }>(admin, 'GET', '/users');
    const left = users.find((u) => u.username === username);
    if (left) await json(admin, 'POST', `/users/${left.id}/deactivate`);
  }
});
