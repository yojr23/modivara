import { expect, test } from '@playwright/test';
import { LoginPage } from './pages';
import { apiAs, json, locationOf } from './support/api';
import { BASE_URL, authFile } from './support/env';

// F1-16: login correcto, login erróneo, bloqueo, logout y aislamiento entre negocios.

test.describe('login por negocio', () => {
  test('con usuario y clave correctos entra a la primera pantalla permitida', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto('bar-demo');
    await login.login('admin');
    await expect(page).toHaveURL('/bar-demo/app/tablero');
    await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
  });

  test('con clave errada muestra un mensaje y no entra', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto('bar-demo');
    await login.login('admin', 'ClaveErrada1');
    await expect(login.alert()).toHaveText('Usuario o contraseña incorrectos.');
    await expect(page).toHaveURL('/bar-demo');
  });

  test('tras 5 intentos fallidos la cuenta se bloquea, con el mismo mensaje que una clave errada', async ({ page, request }) => {
    const admin = await apiAs(['bar-demo', 'admin']);
    const username = `e2e${Date.now() % 1e8}`;
    const password = 'ClaveE2e123';
    const user = await json(admin, 'POST', '/users', { username, display_name: 'Usuario E2E', password });
    // Con un local asignado, el admin (no dueño) puede desactivarlo al final.
    await json(admin, 'PUT', `/users/${user.id}/locations/${await locationOf(admin)}/roles`, { roles: ['staff'] });
    for (let i = 0; i < 5; i++) {
      const r = await request.post('/api/v1/auth/login', { headers: { origin: BASE_URL }, data: { slug: 'bar-demo', username, password: 'Incorrecta1' } });
      expect(r.status()).toBe(401);
    }
    const login = new LoginPage(page);
    await login.goto('bar-demo');
    await login.login(username, password); // la clave correcta ya no sirve: está bloqueada
    await expect(login.alert()).toHaveText('Usuario o contraseña incorrectos.');
    await expect(page).toHaveURL('/bar-demo');
    await json(admin, 'POST', `/users/${user.id}/deactivate`);
  });

  test('salir cierra la sesión y la app vuelve a pedir el login', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto('bar-demo');
    await login.login('admin');
    await expect(page).toHaveURL('/bar-demo/app/tablero');
    await page.getByRole('button', { name: 'Salir' }).click();
    await expect(page).toHaveURL('/bar-demo');
    await page.goto('/bar-demo/app/inventario');
    await expect(page).toHaveURL('/bar-demo');
  });
});

test.describe('aislamiento entre negocios', () => {
  test.use({ storageState: authFile(['bar-demo', 'admin']) });

  test('la URL de otro negocio no muestra sus datos ni los de la sesión bajo su nombre', async ({ page }) => {
    await page.goto('/bar-demo-pisos/app/tablero');
    await expect(page).toHaveURL('/bar-demo/app/tablero'); // vuelve al negocio real de la sesión
    await expect(page.getByText('Bar Demo', { exact: true })).toBeVisible();
    await page.goto('/bar-demo-pisos');
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible(); // para entrar a Pisos hay que iniciar sesión ahí
  });

  test('la API rechaza leer un local de otro negocio con la sesión de este', async () => {
    const pisosLoc = await locationOf(await apiAs(['bar-demo-pisos', 'admin']));
    const admin = await apiAs(['bar-demo', 'admin']);
    for (const path of ['tables', 'service-calls', 'layouts', 'products', 'metrics/service-calls?range=today']) {
      const r = await admin.get(`/api/v1/locations/${pisosLoc}/${path}`);
      expect([403, 404], `${path} → ${r.status()}`).toContain(r.status());
    }
  });
});
