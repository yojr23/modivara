// globalSetup de `pnpm test:integration`: verifica db-test y aplica las migraciones de cada dominio con su rol.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { TEST_DB_PORT, testDatabaseUrl } from './test-db.mjs';

const root = path.resolve(import.meta.dirname, '..');

const reachable = () =>
  new Promise((resolve) => {
    const socket = connect(TEST_DB_PORT, '127.0.0.1');
    socket.once('connect', () => (socket.end(), resolve(true)));
    socket.once('error', () => resolve(false));
  });

export default async function setup() {
  if (!(await reachable())) {
    throw new Error(
      `PostgreSQL de pruebas no responde en 127.0.0.1:${TEST_DB_PORT}. ` +
        'Usa `pnpm test:integration` (levanta db-test) o `docker compose --profile test up -d --wait db-test`.',
    );
  }
  for (const domain of readdirSync(path.join(root, 'domains'))) {
    const pkg = path.join(root, 'domains', domain, 'api');
    if (!existsSync(path.join(pkg, 'src/infrastructure/prisma/migrations'))) continue;
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: pkg,
      env: { ...process.env, [`${domain.toUpperCase()}_DATABASE_URL`]: testDatabaseUrl(domain) },
      stdio: 'pipe',
    });
  }
}
