// Crea una migración de un dominio sin shadow database (el rol del dominio no tiene CREATEDB):
// aplica las migraciones existentes en db-test y calcula el diff contra la base viva.
// Uso: pnpm migration:new <dominio> <nombre>   (requiere `docker compose --profile test up -d --wait db-test`)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { testDatabaseUrl } from './test-db.mjs';

const [domain, name] = process.argv.slice(2);
if (!domain || !/^[a-z0-9_]+$/.test(name ?? '')) {
  console.error('Uso: pnpm migration:new <dominio> <nombre_en_snake_case>');
  process.exit(1);
}
const pkg = path.resolve(import.meta.dirname, '..', 'domains', domain, 'api');
const dir = path.join(pkg, 'src/infrastructure/prisma/migrations');
const env = { ...process.env, [`${domain.toUpperCase()}_DATABASE_URL`]: testDatabaseUrl(domain) };
const prisma = (...args) => execFileSync('pnpm', ['exec', 'prisma', ...args], { cwd: pkg, env, encoding: 'utf8' });

mkdirSync(dir, { recursive: true });
const existing = readdirSync(dir).filter((d) => /^\d{4}_/.test(d)).sort();
if (existing.length) prisma('migrate', 'deploy');

const sql = prisma(
  'migrate', 'diff', '--script',
  ...(existing.length ? ['--from-config-datasource'] : ['--from-empty']),
  '--to-schema', 'src/infrastructure/prisma/schema.prisma',
)
  .split('\n')
  .filter((l) => !/^(Loaded Prisma config|CREATE SCHEMA IF NOT EXISTS|-- CreateSchema)/.test(l)) // el esquema lo crea infra/postgres/init-schemas.sh
  .join('\n');

const folder = `${String(existing.length + 1).padStart(4, '0')}_${name}`;
mkdirSync(path.join(dir, folder));
writeFileSync(
  path.join(dir, folder, 'migration.sql'),
  `${sql.trim()}\n\n-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====\n`,
);
writeFileSync(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
console.log(`Creada ${path.relative(process.cwd(), path.join(dir, folder, 'migration.sql'))}: agrega el SQL explícito y revisa antes de comitear.`);
