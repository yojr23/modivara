import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCorePrisma } from './client.js';

// INV-07 / F4-07: 0003 se aplica sobre una base POBLADA con 0001-0002 (no solo sobre una vacía).
// Base propia y desechable; solo se ejecuta el SQL de las migraciones existentes, en orden.
const DB = 'modivara_mig_populated_core';
const ADMIN = 'postgresql://modivara:test@127.0.0.1:55432';
const url = `postgresql://core_app:test@127.0.0.1:55432/${DB}?schema=core`;
const pkg = path.resolve(import.meta.dirname, '../../..');
const exec = (databaseUrl: string, sql: string) =>
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'execute', '--stdin'], {
    cwd: pkg, input: sql, stdio: 'pipe', env: { ...process.env, CORE_DATABASE_URL: databaseUrl },
  });
const migrate = (...names: string[]) =>
  names.forEach((n) => exec(url, `SET search_path TO core; ${readFileSync(path.join(import.meta.dirname, 'migrations', n, 'migration.sql'), 'utf8')}`));

const db = createCorePrisma(url);
const one = async (sql: string) => (await db.$queryRawUnsafe<{ id: string }[]>(sql))[0]!.id;
const count = async (t: string) => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`))[0]!.n);

beforeAll(() => {
  exec(`${ADMIN}/modivara_test`, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  exec(`${ADMIN}/modivara_test`, `CREATE DATABASE ${DB}`);
  exec(`${ADMIN}/${DB}`, 'CREATE SCHEMA core AUTHORIZATION core_app');
}, 120_000);
afterAll(async () => {
  await db.$disconnect();
  exec(`${ADMIN}/modivara_test`, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});

describe('core: 0001-0002 con datos, luego 0003', () => {
  it('conserva negocio, usuario, membresía, permiso y outbox; después acepta cashier y pos', async () => {
    migrate('0001_init', '0002_outbox_events');
    const org = await one(`INSERT INTO organizations (slug, name) VALUES ('tienda-vieja', 'Tienda vieja') RETURNING id::text`);
    const loc = await one(`INSERT INTO locations (organization_id, name) VALUES ('${org}', 'Principal') RETURNING id::text`);
    const usr = await one(`INSERT INTO app_users (organization_id, username, display_name, password_hash) VALUES ('${org}', 'ana', 'Ana', 'x') RETURNING id::text`);
    await db.$executeRawUnsafe(`INSERT INTO location_memberships (organization_id, user_id, location_id, roles) VALUES ('${org}', '${usr}', '${loc}', ARRAY['admin','staff']::location_role[])`);
    await db.$executeRawUnsafe(`INSERT INTO entitlements (organization_id, module) VALUES ('${org}', 'hospitality')`);
    await db.$executeRawUnsafe(`INSERT INTO outbox_events (event_type, event_version, organization_id, location_id, aggregate_id, correlation_id, payload) VALUES ('core.location.created', 1, '${org}', '${loc}', '${loc}', '${loc}', '{}'::jsonb)`);

    migrate('0003_pos_module');

    for (const t of ['organizations', 'locations', 'app_users', 'location_memberships', 'entitlements', 'outbox_events']) expect(await count(t)).toBe(1);
    expect((await db.$queryRawUnsafe<{ roles: string[] }[]>('SELECT roles::text[] AS roles FROM location_memberships'))[0]!.roles).toEqual(['admin', 'staff']);
    await db.$executeRawUnsafe(`UPDATE location_memberships SET roles = ARRAY['cashier']::location_role[]`);
    await db.$executeRawUnsafe(`INSERT INTO entitlements (organization_id, module) VALUES ('${org}', 'pos')`);
    expect(await count('entitlements')).toBe(2);
  });
});
