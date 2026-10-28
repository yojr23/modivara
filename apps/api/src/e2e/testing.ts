import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AnalyticsModule } from '@modivara/analytics-api';
import { COMMERCE_OUTBOX, CommerceModule } from '@modivara/commerce-api';
import { CoreModule, coreGlobalProviders } from '@modivara/core-api';
import { SESSION_COOKIE, type MeResponse } from '@modivara/core-contracts';
import { HOSPITALITY_OUTBOX, HospitalityModule } from '@modivara/hospitality-api';
import { GATEWAY_API_PATHS, GATEWAY_KEY_HEADER } from '@modivara/hospitality-contracts';
import { IntegrationSubscribersModule } from '../integration-subscribers.module.js';
import { seedCommerce } from '../seed/commerce.js';
import { seedCore } from '../seed/core.js';
import { resetBoth, resetCommerceDb } from '../seed/testing.js';

// Host real (los mismos módulos y el mismo registro de suscriptores que app.module.ts) con los pollers en manual: la prueba llama a `tick()`.
export const PASSWORD = 'Secret123';
const url = (role: string, schema: string) => `postgresql://${role}_app:test@127.0.0.1:55432/modivara_test?schema=${schema}`;
const MANUAL = { outbox: { intervalMs: 3_600_000 } };

const hospitality = HospitalityModule.forRoot({ databaseUrl: url('hospitality', 'hospitality'), mqtt: null, ...MANUAL });
const commerce = CommerceModule.forRoot({ databaseUrl: url('commerce', 'commerce'), ...MANUAL });
const analytics = AnalyticsModule.forRoot({ databaseUrl: url('analytics', 'analytics') });

@Module({
  imports: [
    CoreModule.forRoot({ databaseUrl: url('core', 'core'), ...MANUAL }), hospitality, commerce, analytics,
    IntegrationSubscribersModule.forDomains({ hospitality, commerce, analytics }),
  ],
  providers: [...coreGlobalProviders],
})
class HostModule {}

type Raw = { $executeRawUnsafe(sql: string): Promise<unknown>; $queryRawUnsafe<T>(sql: string): Promise<T> };
const cookies = new Map<string, string>();

/** Arranca el host, limpia las cuatro bases, siembra core y commerce, y deja un botón asignado a una mesa de `bar-demo`. */
export async function startHost() {
  const app: INestApplication = (await Test.createTestingModule({ imports: [HostModule] }).compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const get = <T>(token: string) => app.get<T>(token as never, { strict: false });
  const http = () => request.agent(origin);

  await resetBoth({ get });
  await resetCommerceDb({ get });
  await get<Raw>('ANALYTICS_PRISMA').$executeRawUnsafe('TRUNCATE processed_events, service_call_facts, stock_movement_facts');
  await seedCore(app, PASSWORD);
  await seedCommerce(app, PASSWORD);

  const login = async (slug: string, username: string) => {
    const res = await http().post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
    cookies.set(`${slug}/${username}`, (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!);
  };
  const as = (who: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Cookie', cookies.get(who)!),
    post: (path: string, body?: object, headers: Record<string, string> = {}) => http().post(`/api/v1${path}`).set('Cookie', cookies.get(who)!).set(headers).send(body),
    put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Cookie', cookies.get(who)!).send(body),
  });
  for (const [slug, user] of [['labs', 'superadmin'], ['bar-demo', 'admin'], ['bar-demo', 'barra'], ['bar-demo', 'inventario1']] as const) await login(slug, user);

  const me = (await as('bar-demo/admin').get('/me')).body as MeResponse;
  const locationId = me.locations[0]!.id;
  const organizationId = me.organization!.id;
  await as('labs/superadmin').put('/platform/acting-organization', { organization_id: organizationId });
  const gateway = (await as('labs/superadmin').post(`/platform/locations/${locationId}/gateways`, { name: 'GW' })).body as { key: string };
  const device = (await as('labs/superadmin').post(`/platform/locations/${locationId}/devices`, { code: 'btn-01' })).body as { id: string };
  const table = (await as('bar-demo/admin').post(`/locations/${locationId}/tables`, { label: '1' })).body as { id: string };
  await as('labs/superadmin').post(`/platform/locations/${locationId}/devices/${device.id}/assign`, { table_id: table.id });

  const tick = (token: string) => get<{ tick(): Promise<number> }>(token).tick();
  return {
    app, as, get, locationId, organizationId,
    press: () => http().post(`/api/v1${GATEWAY_API_PATHS.deviceEvents}`).set(GATEWAY_KEY_HEADER, gateway.key).send({ device_code: 'btn-01' }),
    tickHospitality: () => tick(HOSPITALITY_OUTBOX),
    tickCommerce: () => tick(COMMERCE_OUTBOX),
    analyticsDb: get<Raw>('ANALYTICS_PRISMA'),
    hospitalityDb: get<Raw>('HOSPITALITY_PRISMA'),
  };
}
