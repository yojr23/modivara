import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { createPosPrisma } from './client.js';

// INV-07 / F4-07: 0002 y 0003 se aplican sobre una base POBLADA con 0001 (no solo sobre una vacía).
// Base propia y desechable; solo se ejecuta el SQL de las migraciones existentes, en orden.
const DB = 'modivara_mig_populated_pos';
const ADMIN = 'postgresql://modivara:test@127.0.0.1:55432';
const url = `postgresql://pos_app:test@127.0.0.1:55432/${DB}?schema=pos`;
const pkg = path.resolve(import.meta.dirname, '../../..');
const exec = (databaseUrl: string, sql: string) =>
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'execute', '--stdin'], {
    cwd: pkg, input: sql, stdio: 'pipe', env: { ...process.env, POS_DATABASE_URL: databaseUrl },
  });
const migrate = (...names: string[]) =>
  names.forEach((n) => exec(url, `SET search_path TO pos; ${readFileSync(path.join(import.meta.dirname, 'migrations', n, 'migration.sql'), 'utf8')}`));

const db = createPosPrisma(url);
const run = (sql: string) => db.$executeRawUnsafe(sql);
const count = async (t: string) => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${t}`))[0]!.n);

beforeAll(() => {
  exec(`${ADMIN}/modivara_test`, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  exec(`${ADMIN}/modivara_test`, `CREATE DATABASE ${DB}`);
  exec(`${ADMIN}/${DB}`, 'CREATE SCHEMA pos AUTHORIZATION pos_app');
}, 120_000);
afterAll(async () => {
  await db.$disconnect();
  exec(`${ADMIN}/modivara_test`, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
});

describe('pos: 0001 con datos, luego 0002 y 0003', () => {
  it('conserva ventas, líneas, vínculo, clave y evento; aplica los CHECK/FK nuevos y la etiqueta', async () => {
    migrate('0001_init');
    const [org, loc, actor, item, sale, line, link, resource, orgB, saleB] = Array.from({ length: 10 }, () => newId());
    await run(`INSERT INTO location_settings VALUES ('${org}', '${loc}', 'COP', now(), '${actor}')`);
    await run(`INSERT INTO sellable_items (id, organization_id, location_id, name, unit, price, currency, created_at, updated_at, created_by, updated_by)
      VALUES ('${item}', '${org}', '${loc}', 'Queso', 'kg', 1000, 'COP', now(), now(), '${actor}', '${actor}')`);
    await run(`INSERT INTO sales (id, organization_id, location_id, currency, status, payment_method, opened_at, opened_by, closed_at, closed_by)
      VALUES ('${sale}', '${org}', '${loc}', 'COP', 'completed', 'cash', now(), '${actor}', now(), '${actor}')`);
    await run(`INSERT INTO sale_lines (id, sale_id, location_id, sellable_item_id, name_snapshot, unit_snapshot, unit_price_snapshot, quantity, added_at, added_by)
      VALUES ('${line}', '${sale}', '${loc}', '${item}', 'Queso', 'kg', 1000, 0.335, now(), '${actor}')`);
    await run(`INSERT INTO sale_external_links (id, organization_id, location_id, sale_id, provider, resource_type, resource_id, active, created_at, created_by, released_at)
      VALUES ('${link}', '${org}', '${loc}', '${sale}', 'hospitality', 'table', '${resource}', false, now(), '${actor}', now())`);
    await run(`INSERT INTO idempotency_keys (organization_id, key, operation, fingerprint, sale_id) VALUES ('${org}', '${newId()}', 'open_sale', '{}', '${sale}')`);
    await run(`INSERT INTO outbox_events (event_type, event_version, organization_id, location_id, aggregate_id, correlation_id, payload)
      VALUES ('pos.sale.completed', 1, '${org}', '${loc}', '${sale}', '${sale}', '{}'::jsonb)`);
    await run(`INSERT INTO sales (id, organization_id, location_id, currency, status, opened_at, opened_by) VALUES ('${saleB}', '${orgB}', '${newId()}', 'COP', 'open', now(), '${actor}')`);

    migrate('0002_idempotency_scope', '0003_external_link_label');

    for (const t of ['sellable_items', 'sale_lines', 'sale_external_links', 'idempotency_keys', 'outbox_events', 'location_settings']) expect(await count(t)).toBe(1);
    expect(await count('sales')).toBe(2);
    expect((await db.$queryRawUnsafe<{ q: string }[]>('SELECT quantity::text AS q FROM sale_lines'))[0]!.q).toBe('0.335');
    expect((await db.$queryRawUnsafe<{ label: string | null }[]>('SELECT label FROM sale_external_links'))[0]!.label).toBeNull();
    await run(`UPDATE sale_external_links SET label = 'mesa 4'`);
    // 0002: la clave ya no puede apuntar a una venta de otro negocio; 0002: `unit` solo admite enteros.
    await expect(run(`INSERT INTO idempotency_keys (organization_id, key, operation, fingerprint, sale_id) VALUES ('${newId()}', '${newId()}', 'x', '{}', '${saleB}')`)).rejects.toThrow();
    await expect(run(`INSERT INTO sale_lines (id, sale_id, location_id, sellable_item_id, name_snapshot, unit_snapshot, unit_price_snapshot, quantity, added_at, added_by)
      VALUES ('${newId()}', '${sale}', '${loc}', '${item}', 'Queso', 'unit', 1, 0.5, now(), '${actor}')`)).rejects.toThrow();
  });
});
