import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Module, type DynamicModule, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { expect } from 'vitest';
import { BootstrapPlatform, CORE_OUTBOX, CoreModule, CreateUser, ProvisionOrganization, SetLocationRoles } from '@modivara/core-api';
import { SESSION_COOKIE, type LocationRole, type ModuleName } from '@modivara/core-contracts';
import { hostMetadata } from '../app.module.js';

// MOD-12/13: host parcial (misma composición que AppModule) sobre una base propia con SOLO los esquemas de core y de los dominios dados
// migrados, y sin las variables de entorno de los ausentes. Requiere db-test (usa su superusuario de pruebas para crear la base).
export type Domain = 'hospitality' | 'commerce' | 'analytics';
export const PASSWORD = 'Secret123';
export const MANUAL = { outbox: { intervalMs: 3_600_000 } };
export type Raw = { $executeRawUnsafe(sql: string): Promise<unknown>; $queryRawUnsafe<T>(sql: string): Promise<T> };

const root = path.resolve(import.meta.dirname, '../../../..');
const ADMIN_URL = 'postgresql://modivara:test@127.0.0.1:55432/modivara_test';
const envOf = (domain: string) => `${domain.toUpperCase()}_DATABASE_URL`;

/** `prisma db execute`/`migrate deploy` con la URL dada como la del dominio (el cliente pg no es dependencia del host). */
const prisma = (domain: string, databaseUrl: string, args: string[], input?: string) =>
  execFileSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: path.join(root, 'domains', domain, 'api'), input, stdio: 'pipe', env: { ...process.env, [envOf(domain)]: databaseUrl },
  });

/** Arranca el host. `modules(url)` devuelve los DynamicModule de `domains`, con `url(domain)` como su base. */
export async function startPartialHost(db: string, domains: Domain[], modules: (url: (domain: Domain) => string) => DynamicModule[]) {
  const url = (domain: string) => `postgresql://${domain}_app:test@127.0.0.1:55432/${db}?schema=${domain}`;
  const absent = (['hospitality', 'commerce', 'analytics'] as const).filter((d) => !domains.includes(d));
  const saved = absent.map((d) => [envOf(d), process.env[envOf(d)]] as const);
  for (const [name] of saved) delete process.env[name];

  const sql = (databaseUrl: string, script: string) => prisma('core', databaseUrl, ['db', 'execute', '--stdin'], script);
  sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  sql(ADMIN_URL, `CREATE DATABASE ${db}`);
  // Mismos roles que infra/postgres/init-schemas.sh (son del clúster), pero solo estos esquemas.
  const schemas = ['core', ...domains];
  sql(ADMIN_URL.replace('/modivara_test', `/${db}`), schemas.map((s) => `CREATE SCHEMA ${s} AUTHORIZATION ${s}_app;`).join(' '));
  for (const domain of schemas) prisma(domain, url(domain), ['migrate', 'deploy']);

  @Module(hostMetadata(CoreModule.forRoot({ databaseUrl: url('core'), ...MANUAL }), modules(url)))
  class PartialHost {}
  const app: INestApplication = (await Test.createTestingModule({ imports: [PartialHost] }).compile()).createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  const get = <T>(token: string | (new (...a: never[]) => T)) => app.get<T>(token as never, { strict: false });

  const login = async (slug: string, username: string) => {
    const res = await request(origin).post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
    expect(res.status).toBe(200);
    return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
  };
  const as = (cookie: string) => ({
    get: (p: string) => request(origin).get(`/api/v1${p}`).set('Cookie', cookie),
    post: (p: string, body: object = {}, headers: Record<string, string> = {}) => request(origin).post(`/api/v1${p}`).set('Cookie', cookie).set(headers).send(body),
    put: (p: string, body: object) => request(origin).put(`/api/v1${p}`).set('Cookie', cookie).send(body),
  });

  /** Negocio cliente con un local, los módulos dados y un usuario por entrada de `users` (nombre → rol en el local). */
  const provision = async (slug: string, enabled: ModuleName[], users: Record<string, LocationRole>) => {
    const rootActor = await get(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: PASSWORD });
    const { organization, locations } = await get(ProvisionOrganization).execute({ actor: rootActor, slug, name: slug, locations: [{ name: 'Principal' }], modules: enabled });
    const locationId = locations[0]!.id;
    const actor = { ...rootActor, actingOrganizationId: organization.id };
    for (const [username, role] of Object.entries(users)) {
      const user = await get(CreateUser).execute({ actor, username, displayName: username, password: PASSWORD });
      await get(SetLocationRoles).execute({ actor, userId: user.id, locationId, roles: [role] });
    }
    return { organizationId: organization.id, locationId };
  };

  const close = async () => {
    await app.close();
    for (const [name, value] of saved) if (value !== undefined) process.env[name] = value;
  };
  const tickCore = () => get<{ tick(): Promise<number> }>(CORE_OUTBOX).tick();
  return { app, origin, get, login, as, provision, tickCore, close };
}
