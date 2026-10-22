import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import mqtt, { type MqttClient } from 'mqtt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CORE_ACCESS_PORT, newId, type CoreAccessPort } from '@modivara/core-contracts';
import { GATEWAY_API_PATHS, GATEWAY_KEY_HEADER, mqttTopic } from '@modivara/hospitality-contracts';
import { AssignDevice, CreateGateway, CreateTable, HospitalityModule, RegisterDevice } from '../../index.js';
import { TestErrorFilter } from '../../testing/http.js';
import { hospitalityPrismaForTests, resetHospitality, TEST_HOSPITALITY_DATABASE_URL, tenant } from '../../testing/integration.js';

// Broker Mosquitto real y desechable (la imagen sale del compose). Sin ACL: la ACL se verifica con scripts/mqtt-acl-check.sh.
const t = tenant();
const actorUserId = newId();
const core: CoreAccessPort = { getLocation: async (id) => (id === t.locationId ? { id, organizationId: t.organizationId, timezone: 'America/Bogota', active: true } : null) };

@Global()
@Module({ providers: [{ provide: CORE_ACCESS_PORT, useValue: core }], exports: [CORE_ACCESS_PORT] })
class FakeCoreModule {}

const image = /image:\s*(eclipse-mosquitto:\S+)/.exec(readFileSync(new URL('../../../../../../docker-compose.yml', import.meta.url), 'utf8'))![1]!;
const container = `modivara-mqtt-int-${process.pid}`;
const docker = (...args: string[]) => execFileSync('docker', args, { stdio: 'pipe' }).toString();
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(read: () => Promise<T | null | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout esperando el resultado');
    await sleep(100);
  }
}

const db = hospitalityPrismaForTests();
let port: number;
let app: INestApplication;
let publisher: MqttClient;
let key: string;
let gatewayId: string;
let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;

beforeAll(async () => {
  port = await freePort();
  docker('run', '-d', '--name', container, '-p', `127.0.0.1:${port}:1883`, image, 'sh', '-c',
    'printf "listener 1883\\nallow_anonymous true\\n" >/tmp/m.conf && exec mosquitto -c /tmp/m.conf');
  const url = `mqtt://127.0.0.1:${port}`;
  publisher = mqtt.connect(url, { reconnectPeriod: 500 });
  publisher.on('error', () => undefined);
  await eventually(async () => publisher.connected);

  @Module({
    imports: [FakeCoreModule, HospitalityModule.forRoot({ databaseUrl: TEST_HOSPITALITY_DATABASE_URL, mqtt: { url, username: 'api', password: 'x' } })],
    providers: [{ provide: APP_FILTER, useClass: TestErrorFilter }],
  })
  class Host {}
  moduleRef = await Test.createTestingModule({ imports: [Host] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  // Espera a que el adaptador esté suscrito: sin suscripción, el broker descarta lo publicado.
  await resetHospitality(db);
  const probe = (await moduleRef.get(CreateGateway).execute({ ...t, actorUserId, name: 'probe' })).gateway.id;
  await eventually(async () => {
    await viaMqtt(probe, 'heartbeat', {}).catch(() => undefined);
    return (await db.gateway.findUniqueOrThrow({ where: { id: probe } })).lastSeenAt;
  });
});
afterAll(async () => {
  await app?.close();
  await publisher?.endAsync(true);
  await db.$disconnect();
  try { docker('rm', '-f', container); } catch { /* ya no existe */ }
});

beforeEach(async () => {
  await resetHospitality(db);
  const created = await moduleRef.get(CreateGateway).execute({ ...t, actorUserId, name: 'Barra' });
  key = created.plainKey;
  gatewayId = created.gateway.id;
  for (const code of ['http-1', 'mqtt-1']) {
    const table = await moduleRef.get(CreateTable).execute({ ...t, actorUserId, label: code });
    const device = await moduleRef.get(RegisterDevice).execute({ ...t, actorUserId, code });
    await moduleRef.get(AssignDevice).execute({ ...t, actorUserId, deviceId: device.id, tableId: table.id });
  }
});

const viaMqtt = (id: string, kind: 'press' | 'heartbeat', body: object) => publisher.publishAsync(mqttTopic(id, kind), JSON.stringify(body), { qos: 1 });
const viaHttp = (body: object) => request(app.getHttpServer()).post(`/api/v1${GATEWAY_API_PATHS.deviceEvents}`).set(GATEWAY_KEY_HEADER, key).send(body);
const resultsOf = async (deviceCode: string) =>
  (await db.deviceEvent.findMany({ where: { deviceCode }, orderBy: { receivedAt: 'asc' } })).map((e) => e.result);

describe('adaptador MQTT con broker real', () => {
  it('el mismo mensaje por HTTP y por MQTT produce el mismo resultado', async () => {
    await viaHttp({ device_code: 'http-1' });
    await viaHttp({ device_code: 'http-1' });
    await viaMqtt(gatewayId, 'press', { device_code: 'mqtt-1' });
    await viaMqtt(gatewayId, 'press', { device_code: 'mqtt-1' });
    await eventually(async () => (await resultsOf('mqtt-1')).length === 2);
    expect(await resultsOf('mqtt-1')).toEqual(await resultsOf('http-1'));
    expect(await resultsOf('mqtt-1')).toEqual(['call_created', 'debounced']);
    expect(await db.deviceEvent.findFirstOrThrow({ where: { deviceCode: 'mqtt-1' } })).toMatchObject({ gatewayId, transport: 'mqtt', ...t });
    expect(await db.serviceCall.count()).toBe(2);
  });

  it('el tenant sale del gateway del tópico, no del mensaje', async () => {
    await viaMqtt(gatewayId, 'press', { device_code: 'mqtt-1', organization_id: newId(), location_id: newId() });
    const e = await eventually(() => db.deviceEvent.findFirst({ where: { deviceCode: 'mqtt-1' } }));
    expect(e).toMatchObject(t);
    expect(e.payload).not.toHaveProperty('organization_id');
  });

  it('heartbeat por MQTT actualiza last_seen_at', async () => {
    await viaMqtt(gatewayId, 'heartbeat', {});
    await eventually(async () => (await db.gateway.findUniqueOrThrow({ where: { id: gatewayId } })).lastSeenAt);
  });

  it('gateway inexistente, inactivo o mensaje inválido: no crean nada; el siguiente válido sí se procesa', async () => {
    const inactive = await moduleRef.get(CreateGateway).execute({ ...t, actorUserId, name: 'Vieja' });
    await db.gateway.update({ where: { id: inactive.gateway.id }, data: { deactivatedAt: new Date() } });
    await viaMqtt(newId(), 'press', { device_code: 'mqtt-1' });
    await viaMqtt(inactive.gateway.id, 'press', { device_code: 'mqtt-1' });
    await viaMqtt(inactive.gateway.id, 'heartbeat', {});
    await viaMqtt('gw-01', 'press', { device_code: 'mqtt-1' });
    await viaMqtt(gatewayId, 'press', { device_code: '' });
    publisher.publish(mqttTopic(gatewayId, 'press'), 'no es json', { qos: 1 });
    await viaMqtt(gatewayId, 'press', { device_code: 'mqtt-1' });
    await eventually(async () => (await db.deviceEvent.count()) >= 1);
    await sleep(300);
    expect(await db.deviceEvent.count()).toBe(1);
    expect(await db.serviceCall.count()).toBe(1);
    expect((await db.gateway.findUniqueOrThrow({ where: { id: inactive.gateway.id } })).lastSeenAt).toBeNull();
  });

  it('tras reiniciar el broker vuelve a recibir', async () => {
    docker('restart', container);
    // El publicador y el adaptador reconectan solos; se reintenta hasta que el mensaje llega.
    await eventually(async () => {
      if (publisher.connected) await viaMqtt(gatewayId, 'press', { device_code: 'mqtt-1' }).catch(() => undefined);
      return (await db.deviceEvent.count({ where: { deviceCode: 'mqtt-1' } })) > 0;
    }, 40_000);
  }, 60_000);
});
