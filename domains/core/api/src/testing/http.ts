import 'reflect-metadata';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { SESSION_COOKIE } from '@modivara/core-contracts';
import { BootstrapPlatform, CreateUser, ProvisionOrganization, SetLocationRoles, type ActorContext } from '../application/index.js';
import { CoreModule } from '../core.module.js';
import { coreGlobalProviders, LoginRateLimiter, Public, RequireModule, RequirePermission } from '../presentation/index.js';
import { TEST_CORE_DATABASE_URL } from './integration.js';

export const PASSWORD = 'Secret123';

/** Rutas que imitan a las de otros dominios: cada uno las define con los decoradores de core. */
@Controller()
class ProbeController {
  @Public() @Get('probe/public') open() { return { ok: true }; }
  @Get('probe/session') session() { return { ok: true }; }
  @Get('probe/locations/:locationId/calls') @RequirePermission('hospitality.calls.read') @RequireModule('hospitality') calls() { return { ok: true }; }
  @Get('probe/stock') @RequireModule('commerce') stock() { return { ok: true }; }
}

/** Host de pruebas: igual que `apps/api` (CoreModule + guards y filtro globales), más las rutas de sonda. */
@Module({ imports: [CoreModule.forRoot({ databaseUrl: TEST_CORE_DATABASE_URL })], controllers: [ProbeController], providers: [...coreGlobalProviders] })
class TestHostModule {}

export async function createTestApp(opts: { unlimited?: boolean } = {}) {
  let builder = Test.createTestingModule({ imports: [TestHostModule] });
  if (opts.unlimited ?? true) builder = builder.overrideProvider(LoginRateLimiter).useValue({ hit: () => undefined });
  const app: INestApplication = (await builder.compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const http = () => request(origin);
  const get = <T>(token: abstract new (...a: never[]) => T): T => app.get(token, { strict: false });

  /** Inicia sesión y devuelve el valor de la cabecera Cookie para las siguientes peticiones. */
  async function loginAs(slug: string, username: string, password = PASSWORD): Promise<string> {
    const res = await http().post('/api/v1/auth/login').send({ slug, username, password });
    if (res.status !== 200) throw new Error(`login ${slug}/${username} -> ${res.status}`);
    return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
  }
  return { app, http, get, loginAs, origin };
}

/** Escenario: labs (root), bar-demo (admin, mesero) y bar-demo-pisos (adminp, meseroP), con casos de uso reales. */
export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

export async function seedScenario(get: TestApp['get']) {
  const root = await get(BootstrapPlatform).execute({ username: 'root', displayName: 'Root', password: PASSWORD });
  const provision = get(ProvisionOrganization);
  const createUser = get(CreateUser);
  const setRoles = get(SetLocationRoles);

  async function business(slug: string, locationName: string, modules: Array<'hospitality' | 'commerce'>, users: Array<[string, string]>) {
    const { organization, locations } = await provision.execute({ actor: root, slug, name: slug, locations: [{ name: locationName }], modules });
    const actor: ActorContext = { ...root, actingOrganizationId: organization.id };
    const location = locations[0]!;
    const ids: Record<string, string> = {};
    for (const [username, role] of users) {
      const user = await createUser.execute({ actor, username, displayName: username, password: PASSWORD });
      await setRoles.execute({ actor, userId: user.id, locationId: location.id, roles: [role] });
      ids[username] = user.id;
    }
    return { organization, location, userIds: ids };
  }
  const demo = await business('bar-demo', 'Barra', ['hospitality'], [['admin', 'admin'], ['mesero', 'staff']]);
  const pisos = await business('bar-demo-pisos', 'Terraza', ['hospitality', 'commerce'], [['adminp', 'admin'], ['meserop', 'staff']]);
  return { root, demo, pisos };
}
