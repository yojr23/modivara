import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BoardPage, InventoryPage, pageAs } from './pages';
import { apiAs, closeActiveCalls, json, locationOf, press, tableId } from './support/api';
import { ROOT, authFile, gatewayFile } from './support/env';

// Turno simulado sobre la demo sembrada (dos meses de historial), con registro visual en docs/pantallazos/en-vivo/.
// El tablero de Barra (escritorio) y el del mesero (celular) quedan abiertos todo el turno: lo que cambia llega por Socket.IO, sin recargar.
// Las pulsaciones entran como en el local: por HTTP (simulador) y una por MQTT (hardware probable, Q-01). El paso del tiempo se adelanta
// con el reloj del navegador. Al final se cierran los llamados del turno.
const OUT = join(ROOT, 'docs', 'pantallazos', 'en-vivo');
const env = { ...process.env, COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME ?? 'modivara' };

async function shot(page: Page, name: string, fullPage = true) {
  await expect(page.locator('[aria-busy="true"], .skeleton')).toHaveCount(0);
  await page.mouse.move(0, 0); // sin tooltips del último clic
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage, animations: 'disabled' });
}

/** Pulsación por MQTT con el usuario del gateway de Bar Demo (rota su clave en el broker, como `mqtt.spec.ts`). */
function pressMqtt(deviceCode: string) {
  const { id } = JSON.parse(readFileSync(gatewayFile('bar-demo'), 'utf8'));
  const password = execFileSync('bash', ['scripts/mqtt-user.sh', id], { cwd: ROOT, env, encoding: 'utf8' }).match(/contraseña: (\S+)/)![1];
  execFileSync('docker', ['compose', 'exec', '-T', 'mqtt', 'mosquitto_pub', '-u', id, '-P', password, '-q', '1', '-t', `modivara/gw/${id}/press`, '-m', JSON.stringify({ device_code: deviceCode })], { cwd: ROOT, env });
}

const btn = (n: number) => `btn-${String(n).padStart(2, '0')}`;

test('turno en vivo: pulsaciones, tiempos de espera, atención y cierre, métricas del día e inventario', async ({ browser }) => {
  test.setTimeout(180_000);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  const tables = await Promise.all(Array.from({ length: 15 }, (_, i) => tableId(admin, loc, `Mesa ${i + 1}`)));
  for (const t of tables) await closeActiveCalls(admin, loc, t);

  try {
    const desk = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
    const phoneCtx = await browser.newContext({ storageState: authFile(['bar-demo', 'mesero1']), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = new BoardPage(await phoneCtx.newPage());
    await desk.goto('bar-demo');
    await phone.goto('bar-demo');
    await shot(desk.page, '00-inicio-sin-llamados');

    // Primer llamado: aparece en los dos tableros sin recargar.
    expect((await press('bar-demo', btn(3))).result).toBe('call_created');
    await expect(desk.planTable('Mesa 3')).toHaveAccessibleName(/^Mesa 3: Pendiente/);
    await expect(phone.queueCard('Mesa 3')).toBeVisible();
    await shot(desk.page, '01-llega-mesa-3');

    // Hora pico: más mesas por HTTP y la mesa 6 por MQTT.
    for (const n of [1, 8, 11, 14]) expect((await press('bar-demo', btn(n))).result).toBe('call_created');
    pressMqtt(btn(6));
    for (const n of [1, 6, 8, 11, 14]) await expect(desk.queueCard(`Mesa ${n}`)).toBeVisible();
    await shot(desk.page, '02-hora-pico-6-mesas');
    await phone.page.screenshot({ path: join(OUT, '02-hora-pico-celular-mesero.png'), animations: 'disabled' });

    // La mesa 3 insiste: pasada la ventana de 3 s cuenta como repetición del mismo llamado.
    await expect.poll(async () => (await press('bar-demo', btn(3))).result, { intervals: [1_000], timeout: 10_000 }).toBe('repeat_press');
    await desk.open('Mesa 3');
    await expect(desk.page.getByText('Pulsó 2 veces')).toBeVisible();
    await shot(desk.page, '03-mesa-3-pulso-2-veces', false);

    // Barra toma la mesa 3; el mesero lo ve en su celular.
    await desk.page.getByRole('button', { name: 'Marcar en atención, Mesa 3' }).click();
    await expect(phone.queueCard('Mesa 3')).toHaveAccessibleName(/la tomó Barra/);
    await desk.page.keyboard.press('Escape');
    await phone.page.screenshot({ path: join(OUT, '04-celular-mesa-3-la-tomo-barra.png'), animations: 'disabled' });

    // El mesero toma y cierra la mesa 8 desde el celular; desaparece del tablero de Barra.
    // En celular no hay plano: la acción va en la fila de la cola.
    await phone.page.getByRole('button', { name: 'Marcar en atención, Mesa 8' }).click();
    await phone.page.getByRole('button', { name: 'Finalizar, Mesa 8' }).click();
    await expect(desk.queueCard('Mesa 8')).toBeHidden();
    await expect(desk.planTable('Mesa 8')).toHaveAccessibleName(/^Mesa 8: Sin llamados/);
    await shot(desk.page, '05-mesero-cerro-mesa-8');

    // Pasa el tiempo: más de 2 min (ámbar) y más de 5 min (rojo) para quien sigue esperando.
    await desk.page.clock.setFixedTime(Date.now() + 3 * 60_000);
    await expect(desk.planTable('Mesa 1')).toHaveAccessibleName(/más de 2 min/);
    await shot(desk.page, '06-esperando-mas-de-2-min');
    await desk.page.clock.setFixedTime(Date.now() + 6 * 60_000);
    await expect(desk.planTable('Mesa 1')).toHaveAccessibleName(/más de 5 min/);
    await shot(desk.page, '07-esperando-mas-de-5-min');

    // Métricas de hoy: llegan por el outbox a analytics (no son instantáneas); se espera a que la API las tenga.
    await expect.poll(async () => (await json(admin, 'GET', `/locations/${loc}/metrics/service-calls?range=today&group_by=hour`)).totals.calls, { timeout: 30_000 }).toBeGreaterThan(0);
    const metrics = await pageAs(browser, ['bar-demo', 'admin']);
    await metrics.goto('/bar-demo/app/metricas');
    await metrics.getByRole('button', { name: 'Hoy', exact: true }).click();
    await shot(metrics, '08-metricas-hoy');
    await metrics.getByRole('button', { name: '30 días', exact: true }).click();
    await shot(metrics, '09-metricas-30-dias');

    // Historial de hoy con los llamados del turno.
    await metrics.goto('/bar-demo/app/historial');
    await metrics.getByRole('group', { name: 'Atajos de fecha' }).getByRole('button', { name: 'Hoy' }).click();
    await expect(metrics.getByRole('button', { name: /^Mesa 8, .*Tomó Mesero/ }).first()).toBeVisible();
    await shot(metrics, '10-historial-del-turno');
    await metrics.getByRole('button', { name: /^Mesa 3, / }).first().click();
    await expect(metrics.getByRole('dialog', { name: 'Detalle de Mesa 3' })).toBeVisible();
    await shot(metrics, '11-detalle-mesa-3', false);
    await metrics.keyboard.press('Escape');

    // Inventario: una venta registrada desde la pantalla, con su aviso y el saldo nuevo.
    const invPage = await pageAs(browser, ['bar-demo', 'inventario1']);
    const inv = new InventoryPage(invPage);
    await inv.goto();
    await inv.product('Cerveza').first().click();
    await inv.type('Salida').click();
    await inv.register('2', /^Registrar salida/, 'Venta');
    await expect(invPage.getByText(/Salida registrada: −2 botellas de Cerveza/)).toBeVisible();
    await shot(invPage, '12-inventario-venta-registrada');
  } finally {
    for (const t of tables) await closeActiveCalls(admin, loc, t);
  }
});
