import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoreModule, coreGlobalProviders } from '@modivara/core-api';
import { HospitalityModule } from '@modivara/hospitality-api';
import { SESSION_COOKIE, type MeResponse } from '@modivara/core-contracts';
import type { DeviceStatusDto } from '@modivara/hospitality-contracts';
import { seedCore } from '../seed/core.js';
import { resetBoth } from '../seed/testing.js';

// F2-15 (backend): el recorrido completo contra PostgreSQL con los módulos y los guards reales de core.
const CORE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
const HOSPITALITY_URL = 'postgresql://hospitality_app:test@127.0.0.1:55432/modivara_test?schema=hospitality';
const PASSWORD = 'Secret123';

@Module({
  imports: [CoreModule.forRoot({ databaseUrl: CORE_URL }), HospitalityModule.forRoot({ databaseUrl: HOSPITALITY_URL })],
  providers: [...coreGlobalProviders],
})
class E2EHostModule {}

let app: INestApplication;
let http: () => request.Agent;
const cookies = new Map<string, string>();

async function login(slug: string, username: string): Promise<string> {
  const res = await http().post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
  cookies.set(`${slug}/${username}`, cookie);
  return cookie;
}
const as = (who: string) => ({
  get: (path: string) => http().get(`/api/v1${path}`).set('Cookie', cookies.get(who)!),
  post: (path: string, body?: object) => http().post(`/api/v1${path}`).set('Cookie', cookies.get(who)!).send(body),
  put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Cookie', cookies.get(who)!).send(body),
});
type Me = MeResponse;
const locationOf = async (who: string) => ((await as(who).get('/me')).body as Me).locations[0]!.id;
const orgOf = async (who: string) => ((await as(who).get('/me')).body as Me).organization!.id;
type DeviceStatus = DeviceStatusDto;

beforeAll(async () => {
  app = (await Test.createTestingModule({ imports: [E2EHostModule] }).compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  http = () => request.agent(origin);
  await resetBoth({ get: (token) => app.get(token, { strict: false }) });
  await seedCore(app, PASSWORD);
  for (const [slug, user] of [['labs', 'superadmin'], ['bar-demo', 'admin'], ['bar-demo', 'barra'], ['bar-demo-pisos', 'admin']]) await login(slug!, user!);
});
afterAll(() => app.close());

describe('configuración de hospitality de punta a punta', () => {
  it('superadmin crea gateway y botón; admin crea zona y mesa; superadmin vincula; admin ve has_button', async () => {
    const demoLocation = await locationOf('bar-demo/admin');
    const demoOrg = await orgOf('bar-demo/admin');
    const plat = `/platform/locations/${demoLocation}`;

    // Sin elegir negocio, el superadmin no opera sobre un local ajeno a su organización.
    expect((await as('labs/superadmin').get(`${plat}/gateways`)).status).toBe(404);
    expect((await as('labs/superadmin').put('/platform/acting-organization', { organization_id: demoOrg })).status).toBe(200);

    const gw = (await as('labs/superadmin').post(`${plat}/gateways`, { name: 'Barra' })).body as { id: string; key: string };
    const device = (await as('labs/superadmin').post(`${plat}/devices`, { code: 'btn-01' })).body as { id: string };

    const zone = (await as('bar-demo/admin').post(`/locations/${demoLocation}/zones`, { name: 'Terraza' })).body as { id: string };
    const table = (await as('bar-demo/admin').post(`/locations/${demoLocation}/tables`, { label: '1', zone_id: zone.id })).body as { id: string };

    const status = (who: string) => as(who).get(`/locations/${demoLocation}/device-status`);
    expect(((await status('bar-demo/admin')).body as DeviceStatus).tables).toEqual([{ table_id: table.id, has_button: false }]);

    const assign = await as('labs/superadmin').post(`${plat}/devices/${device.id}/assign`, { table_id: table.id });
    expect(assign.status).toBe(204);
    expect(gw.key.length).toBeGreaterThanOrEqual(32);
    const res = await status('bar-demo/admin');
    expect((res.body as DeviceStatus).tables).toEqual([{ table_id: table.id, has_button: true }]);
    for (const secret of ['btn-01', gw.key, gw.id]) expect(JSON.stringify(res.body)).not.toContain(secret);
    expect((await status('bar-demo/barra')).status).toBe(200); // staff también lo ve
  });

  it('un admin recibe 403 en las rutas de plataforma; staff no crea mesas', async () => {
    const demoLocation = await locationOf('bar-demo/admin');
    const plat = `/platform/locations/${demoLocation}`;
    expect((await as('bar-demo/admin').post(`${plat}/gateways`, { name: 'x' })).status).toBe(403);
    expect((await as('bar-demo/admin').get(`${plat}/unknown-devices`)).status).toBe(403);
    expect((await as('bar-demo/admin').post(`${plat}/devices`, { code: 'x' })).status).toBe(403);
    expect((await as('bar-demo/barra').post(`/locations/${demoLocation}/tables`, { label: '2' })).status).toBe(403);
    expect((await as('bar-demo/barra').post(`/locations/${demoLocation}/zones`, { name: 'Z' })).status).toBe(403);
    // …pero sí las lee: el tablero del personal necesita los nombres de mesas y pisos.
    expect((await as('bar-demo/barra').get(`/locations/${demoLocation}/tables`)).status).toBe(200);
    expect((await as('bar-demo/barra').get(`/locations/${demoLocation}/zones`)).status).toBe(200);
  });

  it('un usuario de bar-demo-pisos no ve ni toca las mesas de bar-demo', async () => {
    const demoLocation = await locationOf('bar-demo/admin');
    const pisosLocation = await locationOf('bar-demo-pisos/admin');
    const other = as('bar-demo-pisos/admin');
    expect((await other.get(`/locations/${demoLocation}/tables`)).status).toBe(404);
    expect((await other.get(`/locations/${demoLocation}/device-status`)).status).toBe(404);
    expect((await other.post(`/locations/${demoLocation}/tables`, { label: '9' })).status).toBe(404);
    expect((await other.get(`/locations/${pisosLocation}/tables`)).body).toEqual([]);
    const demoTable = (await as('bar-demo/admin').get(`/locations/${demoLocation}/tables`)).body[0] as { id: string };
    expect((await other.post(`/locations/${pisosLocation}/tables/${demoTable.id}/deactivate`)).status).toBe(404);
  });
});
