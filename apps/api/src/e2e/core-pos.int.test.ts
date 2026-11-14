import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BootstrapPlatform, CoreModule, coreGlobalProviders, CreateUser, ProvisionOrganization, SetLocationRoles } from '@modivara/core-api';
import { SESSION_COOKIE, type IntegrationEvent } from '@modivara/core-contracts';
import { POS_OUTBOX, PosModule } from '@modivara/pos-api';
import { POS_EVENT_HISTORY, saleCompletedV1, saleResultSchema, sellableItemSchema } from '@modivara/pos-contracts';
import { resetPosDb } from '../seed/testing.js';

// POS-08 / POS-40: Core + POS arrancan y venden solos. Sin variables, esquemas, módulos ni suscriptores de Hospitality,
// Commerce o Analytics; si POS dependiera de alguno, este host no compilaría o no arrancaría.
const url = (d: string) => `postgresql://${d}_app:test@127.0.0.1:55432/modivara_test?schema=${d}`;
const MANUAL = { outbox: { intervalMs: 3_600_000 } };
const FOREIGN_ENV = ['HOSPITALITY_DATABASE_URL', 'COMMERCE_DATABASE_URL', 'ANALYTICS_DATABASE_URL'];
const savedEnv = Object.fromEntries(FOREIGN_ENV.map((k) => [k, process.env[k]]));

@Module({
  imports: [CoreModule.forRoot({ databaseUrl: url('core'), ...MANUAL }), PosModule.forRoot({ databaseUrl: url('pos'), ...MANUAL })],
  providers: [...coreGlobalProviders],
})
class CorePosHost {}

type Raw = { $executeRawUnsafe(sql: string): Promise<unknown> };
let app: INestApplication;
const get = <T>(token: unknown) => app.get<T>(token as never, { strict: false });
const PASSWORD = 'Secret123';

beforeAll(async () => {
  for (const k of FOREIGN_ENV) delete process.env[k];
  app = (await Test.createTestingModule({ imports: [CorePosHost] }).compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.init();
  await get<Raw>('CORE_PRISMA').$executeRawUnsafe(
    'TRUNCATE outbox_events, audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE',
  );
  await resetPosDb({ get: (t: string) => get(t) });
});
afterAll(async () => {
  await app?.close();
  for (const [k, v] of Object.entries(savedEnv)) if (v !== undefined) process.env[k] = v;
});

async function posOnlyBusiness() {
  const root = await get<BootstrapPlatform>(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: PASSWORD });
  const { organization, locations } = await get<ProvisionOrganization>(ProvisionOrganization).execute({
    actor: root, slug: 'tienda-sola', name: 'Tienda Sola', locations: [{ name: 'Principal' }], modules: ['pos'],
  });
  const actor = { ...root, actingOrganizationId: organization.id };
  for (const [username, role] of [['admin', 'admin'], ['caja', 'cashier']] as const) {
    const user = await get<CreateUser>(CreateUser).execute({ actor, username, displayName: username, password: PASSWORD });
    await get<SetLocationRoles>(SetLocationRoles).execute({ actor, userId: user.id, locationId: locations[0]!.id, roles: [role] });
  }
  const login = async (username: string) => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ slug: 'tienda-sola', username, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
    return {
      get: (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`).set('Cookie', cookie),
      post: (path: string, body?: object, headers: Record<string, string> = {}) =>
        request(app.getHttpServer()).post(`/api/v1${path}`).set('Cookie', cookie).set(headers).send(body),
    };
  };
  return { locationId: locations[0]!.id, admin: await login('admin'), caja: await login('caja') };
}

describe('Core + POS sin dominios opcionales (POS-40)', () => {
  it('el host no tiene proveedores de otros dominios', () => {
    for (const token of ['HOSPITALITY_PRISMA', 'COMMERCE_PRISMA', 'ANALYTICS_PRISMA']) expect(() => get(token)).toThrow();
  });

  it('negocio solo con POS: catálogo, venta completa y pos.sale.completed.v1 válido en el outbox', async () => {
    const { locationId, admin, caja } = await posOnlyBusiness();
    const base = `/locations/${locationId}/pos`;
    const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });

    const created = await admin.post(`${base}/items`, { name: 'Tenis negro 42', sku: 'ZAP-NEG-42', unit: 'unit', price: '189900' });
    expect(created.status).toBe(201);
    const item = sellableItemSchema.parse(created.body);
    expect((await caja.post(`${base}/items`, { name: 'X', unit: 'unit', price: '1' })).status).toBe(403);

    const opened = await caja.post(`${base}/sales`, undefined, key());
    expect(opened.status).toBe(201);
    const saleId = saleResultSchema.parse(opened.body).sale.id;
    expect((await caja.post(`${base}/sales/${saleId}/lines`, { sellable_item_id: item.id, quantity: '2' }, key())).status).toBe(201);
    const done = await caja.post(`${base}/sales/${saleId}/complete`, { payment_method: 'card' }, key());
    expect(done.status).toBe(201);
    expect(saleResultSchema.parse(done.body).sale).toMatchObject({ status: 'completed', total: '379800.00' });
    expect((await caja.get(`${base}/sales?status=completed`)).body).toHaveLength(1);

    const events: IntegrationEvent[] = [];
    for await (const e of get<{ read(): AsyncIterable<IntegrationEvent> }>(POS_EVENT_HISTORY).read()) events.push(e);
    expect(events).toHaveLength(1);
    expect(saleCompletedV1.parse(events[0])).toMatchObject({
      event_type: 'pos.sale.completed', aggregate_id: saleId, location_id: locationId, payload: { total: '379800.00', payment_method: 'card' },
    });
    // Sin suscriptores registrados, el poller lo marca despachado igual: cerrar una venta no necesita a nadie más.
    expect(await get<{ tick(): Promise<number> }>(POS_OUTBOX).tick()).toBe(1);
  });
});
