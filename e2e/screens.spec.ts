import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BoardPage, LoginPage, pageAs } from './pages';
import { apiAs, closeActiveCalls, json, locationOf, press, tableId } from './support/api';
import { ROOT, USERS, authFile } from './support/env';

// Pantallazos de todas las vistas que ve cada usuario de demo, en docs/pantallazos/ (versionados; ver su README).
// Las vistas salen del menú «Módulos» que el portal arma con los permisos del usuario, más las pestañas de cada pantalla.
const OUT = join(ROOT, 'docs', 'pantallazos');
const TABS = ['Vista', 'Sección', 'Qué medir'];

async function shot(page: Page, file: string) {
  await expect(page.locator('[aria-busy="true"], .skeleton')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
}

// Turno abierto mientras se capturan las vistas: sin esto el tablero, el historial y «Hoy» salen vacíos. Cinco mesas pulsan y Barra toma
// dos; el último test de este archivo cierra todo (y también este afterAll, por si se corre un test suelto).
const OPEN_SHIFT = { pressed: [2, 5, 9, 12, 13], taken: [5, 13] };
test.beforeAll(async () => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const barra = await apiAs(['bar-demo', 'barra']);
  const loc = await locationOf(admin);
  for (const n of OPEN_SHIFT.pressed) {
    await closeActiveCalls(admin, loc, await tableId(admin, loc, `Mesa ${n}`));
    const r = await press('bar-demo', `btn-${String(n).padStart(2, '0')}`);
    if (OPEN_SHIFT.taken.includes(n)) await json(barra, 'POST', `/locations/${loc}/service-calls/${r.service_call_id}/acknowledge`);
  }
});
test.afterAll(async () => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  for (const n of OPEN_SHIFT.pressed) await closeActiveCalls(admin, loc, await tableId(admin, loc, `Mesa ${n}`));
});

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

// Tablero lleno: las 15 mesas de Bar Demo pulsan, Barra toma 3.
// La espera se adelanta con el reloj del navegador (`setFixedTime`) para ver «más de 2 min» y «más de 5 min» sin esperar.
// Escritorio para Barra y celular 390×844 para el mesero; al final se cierran los llamados.
test('tablero con llamados activos, en escritorio y en celular', async ({ browser }) => {
  const dir = join(OUT, 'llamados');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const admin = await apiAs(['bar-demo', 'admin']);
  const barra = await apiAs(['bar-demo', 'barra']);
  const loc = await locationOf(admin);
  const mesas = Array.from({ length: 15 }, (_, i) => i + 1);
  const ids = await Promise.all(mesas.map((n) => tableId(admin, loc, `Mesa ${n}`)));
  for (const t of ids) await closeActiveCalls(admin, loc, t);
  try {
    const calls: string[] = [];
    for (const n of mesas) {
      const r = await press('bar-demo', `btn-${String(n).padStart(2, '0')}`);
      expect(r.result).toBe('call_created');
      calls.push(r.service_call_id!);
    }
    for (const n of [2, 9, 14]) await json(barra, 'POST', `/locations/${loc}/service-calls/${calls[n - 1]}/acknowledge`);

    const desk = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
    await desk.goto('bar-demo');
    await expect(desk.queueCard('Mesa 15')).toBeVisible();
    await shot(desk.page, join(dir, 'barra-escritorio.png'));
    await desk.page.clock.setFixedTime(Date.now() + 6 * 60_000);
    await expect(desk.planTable('Mesa 1')).toHaveAccessibleName(/más de 5 min/);
    await shot(desk.page, join(dir, 'barra-escritorio-6-min.png'));

    const ctx = await browser.newContext({ storageState: authFile(['bar-demo', 'mesero1']), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = new BoardPage(await ctx.newPage());
    await phone.page.clock.setFixedTime(Date.now() + 3 * 60_000);
    await phone.goto('bar-demo');
    await expect(phone.queueCard('Mesa 15')).toBeVisible();
    await phone.page.screenshot({ path: join(dir, 'mesero-celular.png'), animations: 'disabled' });
    await shot(phone.page, join(dir, 'mesero-celular-completo.png'));
  } finally {
    for (const t of ids) await closeActiveCalls(admin, loc, t);
  }
});
