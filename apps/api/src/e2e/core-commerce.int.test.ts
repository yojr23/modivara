import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommerceModule } from '@modivara/commerce-api';
import { BootstrapPlatform, CORE_OUTBOX, CORE_PRISMA, CoreModule, CreateUser, ProvisionOrganization, SetLocationRoles } from '@modivara/core-api';
import { INTEGRATION_EVENT_SUBSCRIBERS, SESSION_COOKIE } from '@modivara/core-contracts';
import { hostMetadata } from '../app.module.js';

// MOD-12 (T01): host Core + Commerce, con la misma composición que AppModule, sobre una base propia con SOLO los esquemas core y commerce
// migrados y sin variables de Hospitality/Analytics. Requiere db-test (usa su superusuario de pruebas para crear la base).
const DB = 'modivara_core_commerce';
const root = path.resolve(import.meta.dirname, '../../../..');
const url = (domain: string, db = DB) => `postgresql://${domain}_app:test@127.0.0.1:55432/${db}?schema=${domain}`;
const ADMIN_URL = 'postgresql://modivara:test@127.0.0.1:55432/modivara_test';
const PASSWORD = 'Secret123';

/** `prisma db execute`/`migrate deploy` con la URL dada como la del dominio (el cliente pg no es dependencia del host). */
const prisma = (domain: string, databaseUrl: string, args: string[], input?: string) =>
  execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: path.join(root, 'domains', domain, 'api'), input, stdio: 'pipe',
    env: { ...process.env, [`${domain.toUpperCase()}_DATABASE_URL`]: databaseUrl },
  });

function createCoreCommerceDatabase() {
  const sql = (databaseUrl: string, script: string) => prisma('core', databaseUrl, ['db', 'execute', '--stdin'], script);
  sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  sql(ADMIN_URL, `CREATE DATABASE ${DB}`);
  // Mismos roles que infra/postgres/init-schemas.sh (son del clúster), pero solo dos esquemas.
  sql(ADMIN_URL.replace('/modivara_test', `/${DB}`), 'CREATE SCHEMA core AUTHORIZATION core_app; CREATE SCHEMA commerce AUTHORIZATION commerce_app;');
  for (const domain of ['core', 'commerce']) prisma(domain, url(domain), ['migrate', 'deploy']);
}

let app: INestApplication;
let origin: string;
const saved = { hospitality: process.env.HOSPITALITY_DATABASE_URL, analytics: process.env.ANALYTICS_DATABASE_URL };
const get = <T>(token: string | (new (...a: never[]) => T)) => app.get<T>(token as never, { strict: false });
type Raw = { $executeRawUnsafe(sql: string): Promise<unknown>; $queryRawUnsafe<T>(sql: string): Promise<T> };

beforeAll(async () => {
  delete process.env.HOSPITALITY_DATABASE_URL;
  delete process.env.ANALYTICS_DATABASE_URL;
  createCoreCommerceDatabase();
  @Module(hostMetadata(CoreModule.forRoot({ databaseUrl: url('core'), outbox: { intervalMs: 3_600_000 } }), [
    CommerceModule.forRoot({ databaseUrl: url('commerce'), outbox: { intervalMs: 3_600_000 } }),
  ]))
  class CoreCommerceHost {}
  app = (await Test.createTestingModule({ imports: [CoreCommerceHost] }).compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});

afterAll(async () => {
  await app?.close();
  for (const [domain, value] of Object.entries(saved)) if (value !== undefined) process.env[`${domain.toUpperCase()}_DATABASE_URL`] = value;
});

describe('MOD-12 host Core + Commerce (sin Hospitality ni Analytics)', () => {
  it('no instancia providers ni consumidores de los dominios ausentes', () => {
    for (const token of ['HOSPITALITY_PRISMA', 'ANALYTICS_PRISMA', 'HOSPITALITY_OUTBOX']) expect(() => get(token)).toThrow();
    expect(get<Array<{ name: string }>>(INTEGRATION_EVENT_SUBSCRIBERS).map((s) => s.name)).toEqual(['core.platform-action-audit', 'commerce.location-created']);
  });

  it('zapatería: login, producto SKU por unidad, entradas/salidas, saldo, permisos, módulo deshabilitado, auditoría y /health/ready', async () => {
    const rootActor = await get(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: PASSWORD });
    const { organization, locations } = await get(ProvisionOrganization).execute({
      actor: rootActor, slug: 'zapateria', name: 'Zapatería', locations: [{ name: 'Principal' }], modules: ['commerce'],
    });
    const locationId = locations[0]!.id;
    const actor = { ...rootActor, actingOrganizationId: organization.id };
    for (const [username, role] of [['inventario', 'inventory'], ['vendedor', 'staff']] as const) {
      const user = await get(CreateUser).execute({ actor, username, displayName: username, password: PASSWORD });
      await get(SetLocationRoles).execute({ actor, userId: user.id, locationId, roles: [role] });
    }
    // core.location.created → commerce siembra motivos y «Principal».
    await get<{ tick(): Promise<number> }>(CORE_OUTBOX).tick();

    const login = async (username: string) => {
      const res = await request(origin).post('/api/v1/auth/login').send({ slug: 'zapateria', username, password: PASSWORD });
      expect(res.status).toBe(200);
      return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
    };
    const inventario = await login('inventario');
    const as = (cookie: string) => ({
      get: (p: string) => request(origin).get(`/api/v1${p}`).set('Cookie', cookie),
      post: (p: string, body: object, headers: Record<string, string> = {}) => request(origin).post(`/api/v1${p}`).set('Cookie', cookie).set(headers).send(body),
    });
    const inv = as(inventario);
    expect((await inv.get('/me')).body.organization.slug).toBe('zapateria');

    const product = await inv.post(`/locations/${locationId}/products`, { name: 'Tenis blanco 40', sku: 'ZAP-NEG-40', unit: 'unit' });
    expect(product.status).toBe(201);
    const [place] = (await inv.get(`/locations/${locationId}/stock-locations`)).body as Array<{ id: string; name: string }>;
    expect(place!.name).toBe('Principal');
    const reasons = (await inv.get('/commerce/movement-reasons')).body as Array<{ id: string; name: string }>;
    const reason = (name: string) => reasons.find((r) => r.name === name)!.id;
    const move = (direction: 'in' | 'out', quantity: string, reasonName: string) =>
      inv.post(`/locations/${locationId}/stock/movements`, {
        stock_location_id: place!.id, product_id: product.body.id, direction, reason_id: reason(reasonName), quantity,
      }, { 'Idempotency-Key': crypto.randomUUID() });
    expect((await move('in', '15', 'Compra')).status).toBe(201);
    expect((await move('out', '2', 'Venta')).status).toBe(201);
    const balances = (await inv.get(`/locations/${locationId}/stock/balances`)).body as Array<{ quantity: string }>;
    expect(balances.map((b) => Number(b.quantity))).toEqual([13]);
    expect((await inv.get(`/locations/${locationId}/stock/movements`)).body).toHaveLength(2);

    // Permiso: staff no tiene commerce.*.
    const denied = await as(await login('vendedor')).get(`/locations/${locationId}/products`);
    expect([denied.status, denied.body.code]).toEqual([403, 'permission_denied']);

    // Entitlement: sin commerce, 403 module_disabled; los datos siguen ahí.
    const coreDb = get<Raw>(CORE_PRISMA);
    await coreDb.$executeRawUnsafe(`UPDATE entitlements SET enabled = false WHERE organization_id = '${organization.id}' AND module = 'commerce'`);
    const disabled = await inv.get(`/locations/${locationId}/products`);
    expect([disabled.status, disabled.body.code]).toEqual([403, 'module_disabled']);
    await coreDb.$executeRawUnsafe(`UPDATE entitlements SET enabled = true WHERE organization_id = '${organization.id}' AND module = 'commerce'`);
    expect((await inv.get(`/locations/${locationId}/products`)).body).toHaveLength(1);

    const audit = await coreDb.$queryRawUnsafe<Array<{ action: string }>>(`SELECT action FROM audit_log WHERE organization_id = '${organization.id}'`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['organization.created', 'location.created', 'entitlement.enabled', 'user.created', 'membership.roles_set']));

    const ready = await request(origin).get('/api/v1/health/ready');
    expect([ready.status, ready.body]).toEqual([200, { status: 'ok', database: 'up' }]);
  });

  it('la base de prueba no tiene esquemas ni tablas de Hospitality/Analytics', async () => {
    const schemas = await get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ nspname: string }>>(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('core', 'commerce', 'hospitality', 'analytics') ORDER BY nspname",
    );
    expect(schemas.map((s) => s.nspname)).toEqual(['commerce', 'core']);
  });
});
