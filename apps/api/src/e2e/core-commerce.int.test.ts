import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommerceModule } from '@modivara/commerce-api';
import { CORE_PRISMA } from '@modivara/core-api';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { INTEGRATION_EVENT_SUBSCRIBERS, type ModuleName } from '@modivara/core-contracts';
import { appMetadata } from '../app.module.js';
import { HOST_TIMEOUT, MANUAL, type Raw, startPartialHost } from './partial-host.js';

// MOD-12 (T01): host Core + Commerce, con la misma composición que AppModule, sobre una base propia con SOLO los esquemas core y commerce
// migrados y sin variables de Hospitality/Analytics.
let host: Awaited<ReturnType<typeof startPartialHost>>;
let origin: string;
const get = <T>(token: string) => host.get<T>(token);
const tickCore = () => host.tickCore();
const login = (slug: string, username: string) => host.login(slug, username);
const as = (cookie: string) => host.as(cookie);
/** Negocio cliente con un local y un usuario `inventario` (rol inventory) y, si se pide, `vendedor` (staff). */
const provision = (slug: string, modules: ModuleName[], staff = false) =>
  host.provision(slug, modules, { inventario: 'inventory', ...(staff && { vendedor: 'staff' as const }) });

beforeAll(async () => {
  host = await startPartialHost('modivara_core_commerce', ['commerce'], (url) => [CommerceModule.forRoot({ databaseUrl: url('commerce'), ...MANUAL })]);
  origin = host.origin;
}, HOST_TIMEOUT);
afterAll(() => host?.close());

describe('MOD-12 host Core + Commerce (sin Hospitality ni Analytics)', () => {
  it('no instancia providers ni consumidores de los dominios ausentes', () => {
    for (const token of ['HOSPITALITY_PRISMA', 'ANALYTICS_PRISMA', 'HOSPITALITY_OUTBOX']) expect(() => get(token)).toThrow();
    expect(get<Array<{ name: string }>>(INTEGRATION_EVENT_SUBSCRIBERS).map((s) => s.name)).toEqual(['core.platform-action-audit', 'commerce.location-created']);
  });

  it('zapatería: login, producto SKU por unidad, entradas/salidas, saldo, permisos, módulo deshabilitado, auditoría y /health/ready', async () => {
    const { organizationId, locationId } = await provision('zapateria', ['commerce'], true);
    // core.location.created → commerce siembra motivos y «Principal».
    await tickCore();
    const inventario = await login('zapateria', 'inventario');
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
    const denied = await as(await login('zapateria', 'vendedor')).get(`/locations/${locationId}/products`);
    expect([denied.status, denied.body.code]).toEqual([403, 'permission_denied']);

    // Entitlement: sin commerce, 403 module_disabled; los datos siguen ahí.
    const coreDb = get<Raw>(CORE_PRISMA);
    await coreDb.$executeRawUnsafe(`UPDATE entitlements SET enabled = false WHERE organization_id = '${organizationId}' AND module = 'commerce'`);
    const disabled = await inv.get(`/locations/${locationId}/products`);
    expect([disabled.status, disabled.body.code]).toEqual([403, 'module_disabled']);
    await coreDb.$executeRawUnsafe(`UPDATE entitlements SET enabled = true WHERE organization_id = '${organizationId}' AND module = 'commerce'`);
    expect((await inv.get(`/locations/${locationId}/products`)).body).toHaveLength(1);

    const audit = await coreDb.$queryRawUnsafe<Array<{ action: string }>>(`SELECT action FROM audit_log WHERE organization_id = '${organizationId}'`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['organization.created', 'location.created', 'entitlement.enabled', 'user.created', 'membership.roles_set']));

    const ready = await request(origin).get('/api/v1/health/ready');
    expect([ready.status, ready.body]).toEqual([200, { status: 'ok', database: 'up' }]);
  });

  /** Filas de commerce del negocio: lugares de stock por nombre y cantidad de motivos. */
  const commerceRows = async (organizationId: string) => {
    const db = get<Raw>('COMMERCE_PRISMA');
    const places = await db.$queryRawUnsafe<Array<{ name: string; is_default: boolean }>>(`SELECT name, is_default FROM stock_locations WHERE organization_id = '${organizationId}'`);
    const [{ n }] = await db.$queryRawUnsafe<[{ n: number }]>(`SELECT count(*)::int AS n FROM movement_reasons WHERE organization_id = '${organizationId}'`);
    return { places: places.map((p) => [p.name, p.is_default]), reasons: n };
  };
  const SEEDED = { places: [['Principal', true]], reasons: SEEDED_MOVEMENT_REASONS.length };
  const NOTHING = { places: [], reasons: 0 };

  it('T11 (MOD-14): local creado antes de contratar commerce → al habilitarlo, un «Principal» y los motivos, una sola vez; sin commerce, nada', async () => {
    const late = await provision('tardia', []);
    const never = await provision('sin-commerce', []);
    await tickCore();
    expect([await commerceRows(late.organizationId), await commerceRows(never.organizationId)]).toEqual([NOTHING, NOTHING]);

    const superadmin = as(await login('labs', 'superadmin'));
    const path = `/platform/organizations/${late.organizationId}/modules/commerce`;
    expect((await as(await login('tardia', 'inventario')).put(path, { enabled: true })).status).toBe(403);
    expect((await superadmin.put(`/platform/organizations/${late.organizationId}/modules/desconocido`, { enabled: true })).status).toBe(400);
    const res = await superadmin.put(path, { enabled: true });
    expect([res.status, res.body]).toEqual([200, { module: 'commerce', enabled: true }]);
    expect((await superadmin.put(path, { enabled: true })).status).toBe(200); // ya habilitado: re-publica sin auditar (idempotente)
    await tickCore();
    await tickCore();
    expect([await commerceRows(late.organizationId), await commerceRows(never.organizationId)]).toEqual([SEEDED, NOTHING]);

    const audit = await get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ action: string }>>(`SELECT action FROM audit_log WHERE organization_id = '${late.organizationId}' AND action LIKE 'entitlement.%'`);
    expect(audit.map((a) => a.action)).toEqual(['entitlement.enabled']);
    expect((await as(await login('tardia', 'inventario')).get(`/locations/${late.locationId}/products`)).status).toBe(200);
  });

  it('Codex #2: activación perdida (core.module.enabled despachado sin commerce compuesto) → habilitar de nuevo la recupera sin otra auditoría', async () => {
    const lost = await provision('perdida', []);
    await tickCore();
    const superadmin = as(await login('labs', 'superadmin'));
    const path = `/platform/organizations/${lost.organizationId}/modules/commerce`;
    expect((await superadmin.put(path, { enabled: true })).status).toBe(200);
    // Lo que hace el poller de un host sin commerce: marca el evento despachado sin consumidor.
    const coreDb = get<Raw>(CORE_PRISMA);
    await coreDb.$executeRawUnsafe(`UPDATE outbox_events SET dispatched_at = now() WHERE organization_id = '${lost.organizationId}' AND dispatched_at IS NULL`);
    await tickCore();
    expect(await commerceRows(lost.organizationId)).toEqual(NOTHING);

    expect((await superadmin.put(path, { enabled: true })).body).toEqual({ module: 'commerce', enabled: true });
    await tickCore();
    expect(await commerceRows(lost.organizationId)).toEqual(SEEDED);
    const audit = await coreDb.$queryRawUnsafe<Array<{ action: string }>>(`SELECT action FROM audit_log WHERE organization_id = '${lost.organizationId}' AND action LIKE 'entitlement.%'`);
    expect(audit.map((a) => a.action)).toEqual(['entitlement.enabled']);
  });

  it('Codex #3: PUT de módulo concurrentes se serializan por negocio: una auditoría por cambio real y estado final coherente', async () => {
    const superadmin = as(await login('labs', 'superadmin'));
    const entitlementAudit = async (organizationId: string) => {
      const rows = await get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ action: string }>>(
        `SELECT action FROM audit_log WHERE organization_id = '${organizationId}' AND action LIKE 'entitlement.%'`,
      );
      return { enabled: rows.filter((r) => r.action === 'entitlement.enabled').length, disabled: rows.filter((r) => r.action === 'entitlement.disabled').length };
    };
    const enabledNow = async (organizationId: string) =>
      (await get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ enabled: boolean }>>(
        `SELECT enabled FROM entitlements WHERE organization_id = '${organizationId}' AND module = 'commerce'`,
      ))[0]?.enabled === true;

    // Duplicados: 6 habilitaciones a la vez sobre un negocio sin commerce → un solo cambio.
    const dup = await provision('concurrente-dup', []);
    const dupPath = `/platform/organizations/${dup.organizationId}/modules/commerce`;
    const dupRes = await Promise.all(Array.from({ length: 6 }, () => superadmin.put(dupPath, { enabled: true })));
    expect(dupRes.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await entitlementAudit(dup.organizationId)).toEqual({ enabled: 1, disabled: 0 });
    expect(await enabledNow(dup.organizationId)).toBe(true);

    // Opuestas: partiendo de suspendido, cada cambio real alterna; el estado final es el del último cambio confirmado.
    const mix = await provision('concurrente-mix', []);
    const mixPath = `/platform/organizations/${mix.organizationId}/modules/commerce`;
    const wanted = [true, false, true, true, false, true, false, true];
    const mixRes = await Promise.all(wanted.map((enabled) => superadmin.put(mixPath, { enabled })));
    expect(mixRes.map((r) => [r.status, r.body.enabled])).toEqual(wanted.map((e) => [200, e]));
    const { enabled, disabled } = await entitlementAudit(mix.organizationId);
    expect(enabled - disabled).toBe((await enabledNow(mix.organizationId)) ? 1 : 0);
  });

  it('T12 (MOD-26): suspender → 403 module_disabled sin borrar nada; reactivar conserva los datos sin duplicar defaults', async () => {
    const { organizationId, locationId } = await provision('suspendida', ['commerce']);
    await tickCore();
    const inv = as(await login('suspendida', 'inventario'));
    const product = await inv.post(`/locations/${locationId}/products`, { name: 'Sandalia 38', sku: 'SAN-38', unit: 'unit' });
    const [place] = (await inv.get(`/locations/${locationId}/stock-locations`)).body as Array<{ id: string }>;
    const compra = ((await inv.get('/commerce/movement-reasons')).body as Array<{ id: string; name: string }>).find((r) => r.name === 'Compra')!;
    expect((await inv.post(`/locations/${locationId}/stock/movements`, {
      stock_location_id: place!.id, product_id: product.body.id, direction: 'in', reason_id: compra.id, quantity: '5',
    }, { 'Idempotency-Key': crypto.randomUUID() })).status).toBe(201);

    const superadmin = as(await login('labs', 'superadmin'));
    const path = `/platform/organizations/${organizationId}/modules/commerce`;
    expect((await superadmin.put(path, { enabled: false })).body).toEqual({ module: 'commerce', enabled: false });
    await tickCore();
    for (const p of [`/locations/${locationId}/products`, `/locations/${locationId}/stock/balances`, '/commerce/movement-reasons']) {
      const res = await inv.get(p);
      expect([p, res.status, res.body.code]).toEqual([p, 403, 'module_disabled']);
    }
    expect((await inv.get('/me')).status).toBe(200); // core sigue operando
    expect(await commerceRows(organizationId)).toEqual(SEEDED);

    expect((await superadmin.put(path, { enabled: true })).body).toEqual({ module: 'commerce', enabled: true });
    await tickCore();
    expect(await commerceRows(organizationId)).toEqual(SEEDED);
    expect(((await inv.get(`/locations/${locationId}/products`)).body as Array<{ id: string }>).map((p) => p.id)).toEqual([product.body.id]);
    expect(((await inv.get(`/locations/${locationId}/stock/balances`)).body as Array<{ quantity: string }>).map((b) => Number(b.quantity))).toEqual([5]);
    const audit = await get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT action FROM audit_log WHERE organization_id = '${organizationId}' AND action LIKE 'entitlement.%' ORDER BY occurred_at`,
    );
    expect(audit.map((a) => a.action)).toEqual(['entitlement.enabled', 'entitlement.disabled', 'entitlement.enabled']);
  });

  it('la base de prueba no tiene esquemas ni tablas de Hospitality/Analytics', async () => {
    const schemas = await get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ nspname: string }>>(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('core', 'commerce', 'hospitality', 'analytics') ORDER BY nspname",
    );
    expect(schemas.map((s) => s.nspname)).toEqual(['commerce', 'core']);
  });

  it('Codex #4: el AppModule desplegable con MODIVARA_DOMAINS=commerce arranca sin variables de Hospitality/Analytics y /health/ready responde 200', async () => {
    const url = (d: string) => `postgresql://${d}_app:test@127.0.0.1:55432/modivara_core_commerce?schema=${d}`;
    const keys = ['MODIVARA_DOMAINS', 'CORE_DATABASE_URL', 'COMMERCE_DATABASE_URL'] as const;
    const saved = keys.map((k) => [k, process.env[k]] as const);
    Object.assign(process.env, { MODIVARA_DOMAINS: 'commerce', CORE_DATABASE_URL: url('core'), COMMERCE_DATABASE_URL: url('commerce') });
    @Module(appMetadata())
    class Deployed {}
    const deployed = (await Test.createTestingModule({ imports: [Deployed] }).compile()).createNestApplication();
    deployed.setGlobalPrefix('api/v1');
    await deployed.listen(0, '127.0.0.1');
    try {
      for (const token of ['HOSPITALITY_PRISMA', 'ANALYTICS_PRISMA']) expect(() => deployed.get(token, { strict: false })).toThrow();
      expect(deployed.get('COMMERCE_PRISMA', { strict: false })).toBeDefined();
      const ready = await request(deployed.getHttpServer()).get('/api/v1/health/ready');
      expect([ready.status, ready.body]).toEqual([200, { status: 'ok', database: 'up' }]);
    } finally {
      await deployed.close();
      for (const [k, v] of saved) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
