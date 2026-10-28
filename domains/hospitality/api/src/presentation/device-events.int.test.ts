import 'reflect-metadata';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CORE_ACCESS_PORT, newId, type CoreAccessPort } from '@modivara/core-contracts';
import { GATEWAY_API_PATHS, GATEWAY_KEY_HEADER } from '@modivara/hospitality-contracts';
import { AssignDevice, CreateGateway, CreateTable, HospitalityModule, RegisterDevice } from '../index.js';
import { hospitalityPrismaForTests, resetHospitality, TEST_HOSPITALITY_DATABASE_URL, tenant } from '../testing/integration.js';
import { TestErrorFilter } from '../testing/http.js';

const mine = tenant();
const other = tenant();
const actorUserId = newId();
let moduleEnabled = true;
const core: CoreAccessPort = {
  isModuleEnabled: async () => moduleEnabled,
  authenticateSession: async () => null,
  permissionsAt: async () => null, userDisplayNames: async () => new Map<string, string>(),
  getLocation: async (id) => [mine, other].map((x) => ({ id: x.locationId, organizationId: x.organizationId, timezone: 'America/Bogota', active: true })).find((l) => l.id === id) ?? null,
};

@Global()
@Module({ providers: [{ provide: CORE_ACCESS_PORT, useValue: core }], exports: [CORE_ACCESS_PORT] })
class FakeCoreModule {}

@Module({ imports: [FakeCoreModule, HospitalityModule.forRoot({ databaseUrl: TEST_HOSPITALITY_DATABASE_URL, rateLimit: { burst: 5, perSecond: 0.001 } })], providers: [{ provide: APP_FILTER, useClass: TestErrorFilter }] })
class Host {}

const db = hospitalityPrismaForTests();
let app: INestApplication;
let key: string;
let gatewayId: string;
let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [Host] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});
beforeEach(async () => {
  moduleEnabled = true;
  await resetHospitality(db);
  const { gateway, plainKey } = await moduleRef.get(CreateGateway).execute({ ...mine, actorUserId, name: 'Barra' });
  key = plainKey;
  gatewayId = gateway.id;
  const table = await moduleRef.get(CreateTable).execute({ ...mine, actorUserId, label: '5' });
  const device = await moduleRef.get(RegisterDevice).execute({ ...mine, actorUserId, code: 'btn-01' });
  await moduleRef.get(AssignDevice).execute({ ...mine, actorUserId, deviceId: device.id, tableId: table.id });
});

const post = (path: string, body: object | string, gatewayKey: string | null = key) => {
  const r = request(app.getHttpServer()).post(`/api/v1${path}`);
  return (gatewayKey === null ? r : r.set(GATEWAY_KEY_HEADER, gatewayKey)).send(body as object);
};
const PRESS = GATEWAY_API_PATHS.deviceEvents;
const BEAT = GATEWAY_API_PATHS.heartbeat;

describe('POST /device-events', () => {
  it('con clave válida crea el llamado del local del gateway', async () => {
    const res = await post(PRESS, { device_code: 'btn-01' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ result: 'call_created', service_call_id: expect.any(String) });
    expect(await db.deviceEvent.findFirstOrThrow()).toMatchObject({ gatewayId, transport: 'http', ...mine });
    expect(await db.serviceCall.count()).toBe(1);
  });

  it.each([
    ['sin clave', null],
    ['clave desconocida', 'mvg_desconocida'],
    ['clave vacía', ''],
  ])('%s: 401 y nada se registra', async (_n, k) => {
    for (const path of [PRESS, BEAT]) expect((await post(path, { device_code: 'btn-01' }, k)).status).toBe(401);
    expect(await db.deviceEvent.count()).toBe(0);
  });

  it('gateway desactivado: 401', async () => {
    await db.gateway.update({ where: { id: gatewayId }, data: { deactivatedAt: new Date() } });
    expect((await post(PRESS, { device_code: 'btn-01' })).status).toBe(401);
    expect((await post(BEAT, {})).status).toBe(401);
  });

  it('organization_id y location_id del cuerpo se ignoran: el tenant sale de la clave', async () => {
    // El botón existe en el OTRO local; si el cuerpo mandara, se crearía allí.
    const table = await moduleRef.get(CreateTable).execute({ ...other, actorUserId, label: '9' });
    const device = await moduleRef.get(RegisterDevice).execute({ ...other, actorUserId, code: 'btn-otro' });
    await moduleRef.get(AssignDevice).execute({ ...other, actorUserId, deviceId: device.id, tableId: table.id });

    const res = await post(PRESS, { device_code: 'btn-otro', organization_id: other.organizationId, location_id: other.locationId });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('unknown_device');
    expect(await db.serviceCall.count()).toBe(0);
    const event = await db.deviceEvent.findFirstOrThrow();
    expect(event).toMatchObject({ ...mine, gatewayId });
    expect(event.payload).not.toHaveProperty('organization_id');
    expect(event.payload).not.toHaveProperty('location_id');
  });

  it.each([
    ['sin device_code', {}],
    ['device_code vacío', { device_code: '' }],
    ['sent_at no ISO', { device_code: 'btn-01', sent_at: 'ayer' }],
  ])('mensaje inválido (%s): 400', async (_n, body) => {
    expect((await post(PRESS, body)).status).toBe(400);
    expect(await db.deviceEvent.count()).toBe(0);
  });

  it('más allá de la ráfaga por gateway: 429 y no se registra nada más; otro gateway no se ve afectado', async () => {
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await post(PRESS, { device_code: 'btn-01' })).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(await db.deviceEvent.count()).toBe(5);
    const second = await moduleRef.get(CreateGateway).execute({ ...mine, actorUserId, name: 'Terraza' });
    expect((await post(PRESS, { device_code: 'btn-01' }, second.plainKey)).status).toBe(200);
  });

  it('cuerpo desmesurado: 413', async () => {
    expect((await post(PRESS, { device_code: 'x'.repeat(200_000) })).status).toBe(413);
  });
});

describe('negocio sin el módulo hospitality', () => {
  it('la pulsación se registra como location_inactive sin crear llamado y el heartbeat no marca conectado', async () => {
    moduleEnabled = false;
    expect((await post(PRESS, { device_code: 'btn-01' })).body.result).toBe('location_inactive');
    expect(await db.serviceCall.count()).toBe(0);
    expect(await db.deviceEvent.count()).toBe(1);
    expect((await post(BEAT, {})).status).toBe(204);
    expect((await db.gateway.findUniqueOrThrow({ where: { id: gatewayId } })).lastSeenAt).toBeNull();
  });
});

describe('POST /gateways/heartbeat', () => {
  it('actualiza last_seen_at del gateway de la clave', async () => {
    expect((await db.gateway.findUniqueOrThrow({ where: { id: gatewayId } })).lastSeenAt).toBeNull();
    const before = Date.now();
    const res = await post(BEAT, {});
    expect(res.status).toBe(204);
    expect((await db.gateway.findUniqueOrThrow({ where: { id: gatewayId } })).lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('mensaje inválido: 400 y no actualiza', async () => {
    expect((await post(BEAT, { sent_at: 'ayer' })).status).toBe(400);
    expect((await db.gateway.findUniqueOrThrow({ where: { id: gatewayId } })).lastSeenAt).toBeNull();
  });
});
