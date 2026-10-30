import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { BoardPage, pageAs } from './pages';
import { apiAs, closeActiveCalls, json, locationOf, press, tableId } from './support/api';
import { ROOT } from './support/env';

// F3-16 y L-07: botón → mesa resaltada en el plano y en la cola → reconocer → finalizar → historial, en tiempo real para
// todo el personal; y reconexión tras reiniciar la API. Las pulsaciones llegan por HTTP con la clave de un gateway de prueba.

test('una pulsación aparece en el plano y en la cola; reconocer y finalizar se ven en vivo en otro tablero', async ({ browser }) => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  const mesa7 = await tableId(admin, loc, 'Mesa 7');
  await closeActiveCalls(admin, loc, mesa7);

  const barra = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
  const otro = new BoardPage(await pageAs(browser, ['bar-demo', 'admin']));
  await barra.goto('bar-demo');
  await otro.goto('bar-demo');

  const { result, service_call_id } = await press('bar-demo', 'btn-07');
  expect(result).toBe('call_created');

  // Sin recargar: llega por Socket.IO a los dos tableros.
  await expect(barra.planTable('Mesa 7')).toHaveAccessibleName(/^Mesa 7: Pendiente/);
  await expect(barra.queueCard('Mesa 7')).toBeVisible();
  await expect(otro.queueCard('Mesa 7')).toBeVisible();

  await barra.open('Mesa 7');
  await barra.page.getByRole('button', { name: 'Marcar en atención' }).click();
  await expect(barra.page.getByText('La tomaste tú').first()).toBeVisible();
  await expect(otro.queueCard('Mesa 7')).toHaveAccessibleName(/la tomó Barra/);
  await expect(otro.planTable('Mesa 7')).toHaveAccessibleName(/^Mesa 7: En atención/);

  await barra.page.getByRole('button', { name: 'Finalizar' }).click();
  await expect(barra.queueCard('Mesa 7')).toBeHidden();
  await expect(otro.queueCard('Mesa 7')).toBeHidden();
  await expect(otro.planTable('Mesa 7')).toHaveAccessibleName(/^Mesa 7: Sin llamados/);

  // Historial (la pantalla es F3-14, pendiente): el llamado quedó cerrado con quién lo tomó y quién lo cerró.
  const detail = await json(admin, 'GET', `/locations/${loc}/service-calls/${service_call_id}`);
  expect(detail).toMatchObject({ status: 'completed', acknowledged_by_name: 'Barra', completed_by_name: 'Barra' });
  expect(detail.transitions.map((t: { action: string }) => t.action)).toEqual(['create', 'acknowledge', 'complete']);
});

test('repetir la pulsación no duplica el llamado: la inmediata se descarta y la siguiente suma pulsaciones', async ({ browser }) => {
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  await closeActiveCalls(admin, loc, await tableId(admin, loc, 'Mesa 5'));
  const board = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
  const page = board.page;
  await board.goto('bar-demo');

  expect((await press('bar-demo', 'btn-05')).result).toBe('call_created');
  await expect(board.queueCard('Mesa 5')).toBeVisible();
  // Dentro de la ventana de 3 s la segunda pulsación se descarta (debounce); después cuenta como repetición del mismo llamado.
  expect((await press('bar-demo', 'btn-05')).result).toBe('debounced');
  await expect.poll(async () => (await press('bar-demo', 'btn-05')).result, { intervals: [1_000], timeout: 10_000 }).toBe('repeat_press');
  await board.open('Mesa 5');
  await expect(page.getByText('Pulsó 2 veces')).toBeVisible();
  await expect(board.queue().getByRole('button', { name: /^Mesa 5,/ })).toHaveCount(1);
  await closeActiveCalls(admin, loc, await tableId(admin, loc, 'Mesa 5'));
});

test('tras reiniciar la API el tablero se reconecta solo y sigue recibiendo llamados', async ({ browser }) => {
  test.slow();
  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  const [mesa8, mesa9] = [await tableId(admin, loc, 'Mesa 8'), await tableId(admin, loc, 'Mesa 9')];
  await closeActiveCalls(admin, loc, mesa8);
  await closeActiveCalls(admin, loc, mesa9);
  const board = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
  await board.goto('bar-demo');
  await press('bar-demo', 'btn-08');
  await expect(board.queueCard('Mesa 8')).toBeVisible();

  execFileSync('docker', ['compose', 'restart', 'api'], { cwd: ROOT, stdio: 'ignore' });
  await expect.poll(async () => (await admin.get('/api/v1/health').catch(() => null))?.ok() ?? false, { timeout: 60_000 }).toBe(true);

  // Lo que había sigue ahí y lo nuevo llega sin recargar la página (el cliente relee por REST al reconectar).
  await expect(board.queueCard('Mesa 8')).toBeVisible();
  await press('bar-demo', 'btn-09');
  await expect(board.queueCard('Mesa 9')).toBeVisible({ timeout: 30_000 });
  await closeActiveCalls(admin, loc, mesa8);
  await closeActiveCalls(admin, loc, mesa9);
});
