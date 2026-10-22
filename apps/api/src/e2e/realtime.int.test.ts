import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CoreModule, coreGlobalProviders } from '@modivara/core-api';
import { GATEWAY_HEALTH_NOTIFIER, HospitalityModule } from '@modivara/hospitality-api';
import { SESSION_COOKIE, type MeResponse } from '@modivara/core-contracts';
import {
  GATEWAY_API_PATHS, GATEWAY_KEY_HEADER, REALTIME_EVENTS as E, REALTIME_PATH, gatewaysStatusSchema, realtimeSubscribeAckSchema, serviceCallSchema,
} from '@modivara/hospitality-contracts';
import { seedCore } from '../seed/core.js';
import { resetBoth } from '../seed/testing.js';

// F3-10 (backend): Socket.IO contra PostgreSQL con CoreModule y los guards reales de core.

const CORE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
const HOSPITALITY_URL = 'postgresql://hospitality_app:test@127.0.0.1:55432/modivara_test?schema=hospitality';
const PASSWORD = 'Secret123';

@Module({
  imports: [CoreModule.forRoot({ databaseUrl: CORE_URL }), HospitalityModule.forRoot({ databaseUrl: HOSPITALITY_URL, outbox: { intervalMs: 50 } })],
  providers: [...coreGlobalProviders],
})
class E2EHostModule {}

let app: INestApplication;
let origin: string;
let http: () => request.Agent;
const cookies = new Map<string, string>();
const sockets: ClientSocket[] = [];

async function login(slug: string, username: string) {
  const res = await http().post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
  expect(res.status).toBe(200);
  cookies.set(`${slug}/${username}`, (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!);
}
const as = (who: string) => ({
  get: (path: string) => http().get(`/api/v1${path}`).set('Cookie', cookies.get(who)!),
  post: (path: string, body?: object) => http().post(`/api/v1${path}`).set('Cookie', cookies.get(who)!).send(body),
  put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Cookie', cookies.get(who)!).send(body),
});
const meOf = async (who: string) => (await as(who).get('/me')).body as MeResponse;

const connect = (opts: { who?: string; origin?: string } = {}): ClientSocket => {
  const cookie = opts.who && cookies.get(opts.who);
  const s = io(origin, {
    path: REALTIME_PATH, transports: ['websocket'], reconnection: false, forceNew: true,
    extraHeaders: { ...(cookie && { cookie }), ...(opts.origin && { origin: opts.origin }) },
  });
  sockets.push(s);
  return s;
};
const connected = (s: ClientSocket) => new Promise<void>((res, rej) => { s.on('connect', res); s.on('connect_error', (e: Error) => rej(e)); });
const subscribe = (s: ClientSocket, location_id: string) => new Promise<unknown>((res) => s.emit(E.subscribe, { location_id }, res));
const next = <T>(s: ClientSocket, event: string, ms = 3000) =>
  new Promise<T>((res, rej) => { const timer = setTimeout(() => rej(new Error(`sin ${event}`)), ms); s.once(event, (p: T) => { clearTimeout(timer); res(p); }); });
const silent = async (s: ClientSocket, event: string) => {
  let got = false;
  s.on(event, () => { got = true; });
  await new Promise((r) => setTimeout(r, 400));
  return !got;
};

const gatewayKeys = new Map<string, string>();
let demoLocation: string, pisosLocation: string;

beforeAll(async () => {
  app = (await Test.createTestingModule({ imports: [E2EHostModule] }).compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0, '127.0.0.1');
  origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  http = () => request.agent(origin);
  await resetBoth({ get: (token) => app.get(token, { strict: false }) });
  await seedCore(app, PASSWORD);
  for (const [slug, user] of [['labs', 'superadmin'], ['bar-demo', 'admin'], ['bar-demo', 'barra'], ['bar-demo', 'inventario1'], ['bar-demo-pisos', 'admin']]) await login(slug!, user!);

  // Un gateway, un botón y una mesa por negocio (el superadmin opera sobre cada negocio por turno).
  for (const slug of ['bar-demo', 'bar-demo-pisos']) {
    const { id: location } = (await meOf(`${slug}/admin`)).locations[0]!;
    const orgId = (await meOf(`${slug}/admin`)).organization!.id;
    await as('labs/superadmin').put('/platform/acting-organization', { organization_id: orgId });
    const gw = (await as('labs/superadmin').post(`/platform/locations/${location}/gateways`, { name: 'GW' })).body as { key: string };
    const device = (await as('labs/superadmin').post(`/platform/locations/${location}/devices`, { code: 'btn-01' })).body as { id: string };
    const table = (await as(`${slug}/admin`).post(`/locations/${location}/tables`, { label: '1' })).body as { id: string };
    await as('labs/superadmin').post(`/platform/locations/${location}/devices/${device.id}/assign`, { table_id: table.id });
    gatewayKeys.set(slug, gw.key);
    if (slug === 'bar-demo') demoLocation = location; else pisosLocation = location;
  }
});
afterEach(() => { for (const s of sockets.splice(0)) s.disconnect(); });
afterAll(() => app.close());

const press = (slug: string) =>
  http().post(`/api/v1${GATEWAY_API_PATHS.deviceEvents}`).set(GATEWAY_KEY_HEADER, gatewayKeys.get(slug)!).send({ device_code: 'btn-01' });

describe('F3-10 tiempo real de punta a punta', () => {
  it('rechaza sin cookie, con sesión inventada y con Origin ajeno', async () => {
    await expect(connected(connect())).rejects.toThrow('unauthorized');
    const bad = io(origin, { path: REALTIME_PATH, transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: { cookie: `${SESSION_COOKIE}=inventada` } });
    sockets.push(bad); // cookie con un token inventado
    await expect(connected(bad)).rejects.toThrow('unauthorized');
    await expect(connected(connect({ who: 'bar-demo/barra', origin: 'https://malo.example' }))).rejects.toThrow('forbidden_origin');
  });

  it('suscripción: su local ok; local ajeno o rol sin calls.read -> ok:false', async () => {
    const barra = connect({ who: 'bar-demo/barra' });
    await connected(barra);
    expect(realtimeSubscribeAckSchema.parse(await subscribe(barra, demoLocation))).toEqual({ ok: true });
    expect(await subscribe(barra, pisosLocation)).toMatchObject({ ok: false });
    const inventory = connect({ who: 'bar-demo/inventario1' });
    await connected(inventory);
    expect(await subscribe(inventory, demoLocation)).toMatchObject({ ok: false, code: 'permission_denied' });
  });

  it('una pulsación HTTP llega al local A y no al B; reconocer llega con el estado nuevo; el outbox queda despachado', async () => {
    const barra = connect({ who: 'bar-demo/barra' }), pisosAdmin = connect({ who: 'bar-demo-pisos/admin' });
    await Promise.all([connected(barra), connected(pisosAdmin)]);
    await subscribe(barra, demoLocation);
    await subscribe(pisosAdmin, pisosLocation);

    const created = next<unknown>(barra, E.serviceCallChanged);
    const otherSide = silent(pisosAdmin, E.serviceCallChanged);
    const res = await press('bar-demo');
    expect(res.status).toBe(200);
    const call = serviceCallSchema.parse(await created);
    expect(call).toMatchObject({ location_id: demoLocation, status: 'pending', table_display_name: '1', press_count: 1 });
    expect(await otherSide).toBe(true);

    const changed = next<unknown>(barra, E.serviceCallChanged);
    expect((await as('bar-demo/barra').post(`/locations/${demoLocation}/service-calls/${call.id}/acknowledge`)).status).toBe(200);
    expect(serviceCallSchema.parse(await changed)).toMatchObject({ id: call.id, status: 'in_progress' });

    // El poller (en el mismo proceso) despacha los eventos created y acknowledged sin suscriptores.
    const db = app.get<{ outboxEvent: { count(a: object): Promise<number> } }>('HOSPITALITY_PRISMA', { strict: false });
    for (let i = 0; i < 40 && (await db.outboxEvent.count({ where: { dispatchedAt: null } })) > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await db.outboxEvent.count({ where: { dispatchedAt: null } })).toBe(0);
    expect(await db.outboxEvent.count({})).toBe(2);
  });

  it('gateways.status llega a la sala del local en la transición', async () => {
    const barra = connect({ who: 'bar-demo/barra' });
    await connected(barra);
    await subscribe(barra, demoLocation);
    const got = next<unknown>(barra, E.gatewaysStatus);
    await app.get<{ connectivityChanged(c: object): Promise<void> }>(GATEWAY_HEALTH_NOTIFIER, { strict: false }).connectivityChanged({
      organizationId: (await meOf('bar-demo/barra')).organization!.id, locationId: demoLocation, connected: false, disconnectedGatewayIds: [],
    });
    expect(gatewaysStatusSchema.parse(await got)).toEqual({ location_id: demoLocation, connectivity: 'some_disconnected' });
  });

  it('tras cerrar sesión, el socket deja de recibir y se cierra en el siguiente aviso', async () => {
    await login('bar-demo', 'barra');
    const barra = connect({ who: 'bar-demo/barra' });
    await connected(barra);
    await subscribe(barra, demoLocation);
    expect((await as('bar-demo/barra').post('/auth/logout')).status).toBeLessThan(300);
    const closed = new Promise<string>((res) => barra.once('disconnect', res));
    // Hace falta otro cambio de estado en el local: el llamado ya existe; una nueva mesa/pulsación.
    const admin = as('bar-demo/admin');
    await as('labs/superadmin').put('/platform/acting-organization', { organization_id: (await meOf('bar-demo/admin')).organization!.id });
    const table = (await admin.post(`/locations/${demoLocation}/tables`, { label: '2' })).body as { id: string };
    const device = (await as('labs/superadmin').post(`/platform/locations/${demoLocation}/devices`, { code: 'btn-02' })).body as { id: string };
    await as('labs/superadmin').post(`/platform/locations/${demoLocation}/devices/${device.id}/assign`, { table_id: table.id });
    await http().post(`/api/v1${GATEWAY_API_PATHS.deviceEvents}`).set(GATEWAY_KEY_HEADER, gatewayKeys.get('bar-demo')!).send({ device_code: 'btn-02' });
    expect(await closed).toBe('io server disconnect');
  });
});
