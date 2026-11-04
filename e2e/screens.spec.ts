import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { LoginPage, pageAs } from './pages';
import { ROOT, USERS } from './support/env';

// Pantallazos de todas las vistas que ve cada usuario de demo, en docs/pantallazos/ (versionados; ver su README).
// Las vistas salen del menú «Módulos» que el portal arma con los permisos del usuario, más las pestañas de cada pantalla.
const OUT = join(ROOT, 'docs', 'pantallazos');
const TABS = ['Vista', 'Sección', 'Qué medir'];

async function shot(page: Page, file: string) {
  await expect(page.locator('[aria-busy="true"], .skeleton')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
}

test('portada y login de cada negocio', async ({ page }) => {
  mkdirSync(join(OUT, 'login'), { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '¿Cuál es tu negocio?' })).toBeVisible();
  await shot(page, join(OUT, 'login', '00-portada.png'));
  for (const slug of new Set(USERS.map(([s]) => s))) {
    await new LoginPage(page).goto(slug);
    await shot(page, join(OUT, 'login', `${slug}.png`));
  }
});

for (const user of USERS) {
  test(`vistas de ${user.join('/')}`, async ({ browser }) => {
    const dir = join(OUT, user.join('-'));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const page = await pageAs(browser, user);
    await page.goto(`/${user[0]}/app`);
    const links = page.getByRole('navigation', { name: 'Módulos' }).first().getByRole('link');
    await expect(links.first()).toBeVisible();
    const screens = await links.evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).pathname));
    for (const [i, path] of screens.entries()) {
      const name = `${String(i + 1).padStart(2, '0')}-${path.split('/').pop()}`;
      await page.goto(path);
      await shot(page, join(dir, `${name}.png`));
      // Consola del superadmin: sin negocio elegido no hay secciones; actúa en Bar Demo y al final deja de actuar.
      const acting = (await page.getByLabel('Negocio').count()) > 0;
      if (acting) {
        await page.getByLabel('Negocio').selectOption({ label: 'Bar Demo' });
        await expect(page.getByRole('status').filter({ hasText: 'Estás actuando en Bar Demo' })).toBeVisible();
        await page.getByLabel('Local').selectOption({ label: 'Principal' });
        await shot(page, join(dir, `${name}-bar-demo.png`));
      }
      // Inventario: el historial completo (filtros y «Cargar más» en servidor) se abre con «Ver historial».
      const history = page.getByRole('button', { name: 'Ver historial', exact: true });
      if (await history.count()) {
        await history.click();
        await shot(page, join(dir, `${name}-historial.png`));
      }
      for (const label of TABS) {
        const options = page.getByRole('group', { name: label, exact: true }).getByRole('button', { pressed: false });
        for (const text of await options.allInnerTexts()) {
          await page.getByRole('group', { name: label, exact: true }).getByRole('button', { name: text, exact: true }).click();
          await shot(page, join(dir, `${name}-${text.toLowerCase().replaceAll(/[^a-z0-9áéíóúñ]+/g, '-')}.png`));
        }
      }
      if (acting) await page.getByRole('button', { name: 'Dejar de actuar' }).click();
    }
  });
}
