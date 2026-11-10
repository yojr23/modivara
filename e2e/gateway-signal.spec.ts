import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, request, test } from '@playwright/test';
import { BoardPage, pageAs } from './pages';
import { ROOT, gatewayFile } from './support/env';

// MOD-05 en vivo: se apaga el simulador (el gateway de Bar Demo deja de mandar señal de vida) con el tablero abierto; el aviso llega
// por Socket.IO sin recargar y se va solo cuando vuelve la señal. Capturas en docs/pantallazos/en-vivo/.
const env = { ...process.env, COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME ?? 'modivara' };
const compose = (...args: string[]) => execFileSync('docker', ['compose', ...args], { cwd: ROOT, env, stdio: 'ignore' });
const OUT = join(ROOT, 'docs', 'pantallazos', 'en-vivo');

test('el tablero avisa en vivo cuando el gateway pierde la señal y cuando vuelve', async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const board = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
  const banner = board.page.getByText('Sin señal de botones');
  // El «Gateway E2E» de global-setup no tiene simulador: se le da señal de vida durante la prueba para que el aviso sea solo del de demo.
  const { key } = JSON.parse(readFileSync(gatewayFile('bar-demo'), 'utf8'));
  const api = await request.newContext();
  const beat = () => api.post('/api/v1/gateways/heartbeat', { headers: { 'x-gateway-key': key }, data: {} });
  await beat();
  const alive = setInterval(() => void beat(), 10_000);
  await board.goto('bar-demo');
  await expect(banner).toBeHidden({ timeout: 60_000 });
  try {
    compose('stop', 'button-sim');
    await expect(banner).toBeVisible({ timeout: 3 * 60_000 });
    await board.page.mouse.move(0, 0);
    await board.page.screenshot({ path: join(OUT, '13-gateway-sin-senal.png'), animations: 'disabled' });
  } finally {
    compose('start', 'button-sim');
  }
  try {
    await expect(banner).toBeHidden({ timeout: 2 * 60_000 });
    await board.page.screenshot({ path: join(OUT, '14-gateway-recupera-senal.png'), animations: 'disabled' });
  } finally {
    clearInterval(alive);
  }
});
