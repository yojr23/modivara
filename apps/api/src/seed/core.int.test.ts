import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreModule, DeactivateUser, GetMe, ListUsers, Login, SetLocationRoles, type ActorContext } from '@modivara/core-api';
import { seedCore } from './core.js';

// F1-11: el seed se puede repetir y deja usuarios que inician sesión de verdad. Requiere db-test (esquema core migrado).
const url = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
@Module({ imports: [CoreModule.forRoot({ databaseUrl: url })] })
class SeedTestModule {}

// Misma contraseña que usan las demás pruebas de integración: la base de pruebas puede traer sus usuarios.
const PASSWORD = 'Secret123';
const USERS: Array<[string, string]> = [
  ['labs', 'superadmin'], ['bar-demo', 'admin'], ['bar-demo', 'barra'], ['bar-demo', 'mesero1'],
  ['bar-demo', 'inventario1'], ['bar-demo', 'caja1'], ['bar-demo-pisos', 'admin'], ['tienda-demo', 'admin'],
  ['zapateria-demo', 'admin'], ['zapateria-demo', 'inventario1'], ['restaurante-demo', 'admin'],
];

// Lo mínimo del cliente Prisma que usa esta prueba (el cliente no es parte de la superficie pública de core-api).
interface TestDb {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  organization: { findFirstOrThrow(a: object): Promise<{ id: string }> };
  location: { findFirstOrThrow(a: object): Promise<{ id: string }> };
  appUser: { findMany(a: object): Promise<Array<{ deactivatedAt: Date | null }>> };
  locationMembership: { findFirstOrThrow(a: object): Promise<{ roles: string[] }> };
  entitlement: { findMany(a: object): Promise<Array<{ module: string }>> };
}

// La base de pruebas es compartida y esta prueba deja usuarios desactivados: parte siempre de un esquema vacío.
const reset = (app: { get<T>(token: string): T }) =>
  app.get<TestDb>('CORE_PRISMA').$executeRawUnsafe('TRUNCATE audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE');

describe('seed:core', () => {
  it('es idempotente y los usuarios inician sesión', async () => {
    const app = await NestFactory.createApplicationContext(SeedTestModule, { logger: false });
    try {
      await reset(app);
      await seedCore(app, PASSWORD);
      await seedCore(app, PASSWORD);
      const login = app.get(Login);
      for (const [slug, username] of USERS) {
        expect((await login.execute({ slug, username, password: PASSWORD })).username).toBe(username);
      }
      // Paquetes aislados (MOD-61/74): cada demo solo con sus módulos.
      const root = (await login.execute({ slug: 'labs', username: 'superadmin', password: PASSWORD })).actor;
      const modules = async (slug: string) => {
        const id = (await app.get<TestDb>('CORE_PRISMA').organization.findFirstOrThrow({ where: { slug } })).id;
        return app.get(GetMe).execute({ actor: { ...root, actingOrganizationId: id } }).then((m) => m.modules.sort());
      };
      expect(await modules('zapateria-demo')).toEqual(['commerce']);
      expect(await modules('restaurante-demo')).toEqual(['hospitality']);
      expect(await modules('bar-demo')).toEqual(['analytics', 'commerce', 'hospitality']);
    } finally {
      await app.close();
    }
  });

  it('cada negocio de demo contrata solo sus productos (POS-001 §7)', async () => {
    const app = await NestFactory.createApplicationContext(SeedTestModule, { logger: false });
    try {
      await reset(app);
      await seedCore(app, PASSWORD);
      const db = app.get<TestDb>('CORE_PRISMA');
      const modulesOf = async (slug: string) =>
        (await db.entitlement.findMany({ where: { organization: { slug }, enabled: true } })).map((e) => e.module).sort();
      expect(await modulesOf('bar-demo')).toEqual(['analytics', 'commerce', 'hospitality', 'pos']);
      expect(await modulesOf('bar-demo-pisos')).toEqual(['analytics', 'commerce', 'hospitality']);
      expect(await modulesOf('tienda-demo')).toEqual(['pos']);
      const caja = (await app.get(Login).execute({ slug: 'bar-demo', username: 'caja1', password: PASSWORD })).actor;
      expect((await db.locationMembership.findFirstOrThrow({ where: { userId: caja.actorUserId } })).roles).toEqual(['cashier']);
    } finally {
      await app.close();
    }
  });

  it('no recrea usuarios desactivados ni reasigna roles de los existentes', async () => {
    const app = await NestFactory.createApplicationContext(SeedTestModule, { logger: false });
    try {
      await reset(app);
      await seedCore(app, PASSWORD);
      const db = app.get<TestDb>('CORE_PRISMA'); // token interno de core: la prueba mira la base directamente
      const login = app.get(Login);
      const root = (await login.execute({ slug: 'labs', username: 'superadmin', password: PASSWORD })).actor;
      const demo = (await db.organization.findFirstOrThrow({ where: { slug: 'bar-demo' } })).id;
      const actor: ActorContext = { ...root, actingOrganizationId: demo };
      const users = await app.get(ListUsers).execute({ actor });
      const id = (name: string) => users.find((u) => u.user.username === name)!.user.id;
      const location = (await db.location.findFirstOrThrow({ where: { organizationId: demo } })).id;

      await app.get(DeactivateUser).execute({ actor, userId: id('barra') });
      await app.get(SetLocationRoles).execute({ actor, userId: id('mesero1'), locationId: location, roles: ['admin'] });
      await seedCore(app, PASSWORD);

      expect(await db.appUser.findMany({ where: { organizationId: demo, username: 'barra' } })).toMatchObject([{ deactivatedAt: expect.any(Date) }]);
      const membership = await db.locationMembership.findFirstOrThrow({ where: { userId: id('mesero1') } });
      expect(membership.roles).toEqual(['admin']);
    } finally {
      await app.close();
    }
  });

  describe('producción', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('se niega a correr con NODE_ENV=production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      await expect(seedCore({} as never, PASSWORD)).rejects.toThrow(/NODE_ENV=production/);
    });
  });
});
