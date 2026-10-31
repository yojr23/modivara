import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BoardPage, pageAs } from './pages';
import { apiAs, closeActiveCalls, locationOf, tableId } from './support/api';
import { ROOT, gatewayFile } from './support/env';

// El hardware real probablemente hablará MQTT (Q-01): la pulsación entra por el broker con el usuario del gateway
// (usuario = id del gateway; la ACL solo le deja publicar en modivara/gw/<id>/#) y llega al tablero igual que por HTTP.
// El puerto del broker no está publicado, así que se publica con mosquitto_pub dentro del contenedor.
// ponytail: proyecto de Compose «modivara» (la demo); con otro nombre, definir COMPOSE_PROJECT_NAME.
const env = { ...process.env, COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME ?? 'modivara' };

test('una pulsación publicada por MQTT aparece en el tablero y se puede cerrar', async ({ browser }) => {
  const { id } = JSON.parse(readFileSync(gatewayFile('bar-demo'), 'utf8'));
  // Rota la contraseña del gateway E2E en el broker (recarga por SIGHUP, sin cortar conexiones) y la lee de la salida.
  const out = execFileSync('bash', ['scripts/mqtt-user.sh', id], { cwd: ROOT, env, encoding: 'utf8' });
  const password = out.match(/contraseña: (\S+)/)![1];

  const admin = await apiAs(['bar-demo', 'admin']);
  const loc = await locationOf(admin);
  const mesa6 = await tableId(admin, loc, 'Mesa 6');
  await closeActiveCalls(admin, loc, mesa6);
  const board = new BoardPage(await pageAs(browser, ['bar-demo', 'barra']));
  await board.goto('bar-demo');

  const message = JSON.stringify({ device_code: 'btn-06' });
  execFileSync(
    'docker', ['compose', 'exec', '-T', 'mqtt', 'mosquitto_pub', '-u', id, '-P', password, '-q', '1', '-t', `modivara/gw/${id}/press`, '-m', message],
    { cwd: ROOT, env },
  );

  await expect(board.planTable('Mesa 6')).toHaveAccessibleName(/^Mesa 6: Pendiente/);
  await expect(board.queueCard('Mesa 6')).toBeVisible();
  await closeActiveCalls(admin, loc, mesa6);
  await expect(board.queueCard('Mesa 6')).toBeHidden();
});
