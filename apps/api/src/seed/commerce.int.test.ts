import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapPlatform, CoreModule, ProvisionOrganization } from '@modivara/core-api';
import { CommerceModule, GetBalances, ListMovementReasons, ListMovements, ListProducts, ListStockLocations } from '@modivara/commerce-api';
import { seedCore } from './core.js';
import { seedCommerce } from './commerce.js';
import { resetCommerceDb } from './testing.js';

// El seed de commerce se puede repetir y deja el mismo estado. Requiere db-test.
const CORE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
const COMMERCE_URL = 'postgresql://commerce_app:test@127.0.0.1:55432/modivara_test?schema=commerce';
@Module({ imports: [CoreModule.forRoot({ databaseUrl: CORE_URL }), CommerceModule.forRoot({ databaseUrl: COMMERCE_URL, outbox: false })] })
class SeedTestModule {}

const PASSWORD = 'Secret123';
describe('seed:commerce', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('siembra motivos, «Principal» y 10 productos con su entrada inicial; repetirlo deja el mismo estado', async () => {
    const app = await NestFactory.createApplicationContext(SeedTestModule, { logger: false });
    try {
      await app.get<{ $executeRawUnsafe(sql: string): Promise<unknown> }>('CORE_PRISMA').$executeRawUnsafe(
        'TRUNCATE audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE',
      );
      await resetCommerceDb(app);
      await seedCore(app, PASSWORD);

      const root = await app.get(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: PASSWORD });
      const ctx = async (slug: string) => {
        const { organization, locations } = await app.get(ProvisionOrganization).execute({
          actor: root, slug, name: slug, locations: [{ name: 'Principal' }], modules: ['commerce'],
        });
        return { organizationId: organization.id, locationId: locations[0]!.id, actorUserId: root.actorUserId };
      };
      const snapshot = async () => {
        const out: unknown[] = [];
        for (const slug of ['bar-demo', 'bar-demo-pisos']) {
          const c = await ctx(slug);
          const products = await app.get(ListProducts).execute(c);
          const balances = await app.get(GetBalances).execute(c);
          out.push({
            slug,
            products: products.map((p) => p.name).sort(),
            places: (await app.get(ListStockLocations).execute(c)).map((s) => [s.name, s.isDefault]),
            reasons: (await app.get(ListMovementReasons).execute(c)).length,
            balances: balances.map((b) => [b.productId, b.quantity.toString()]).sort(),
            movements: (await app.get(ListMovements).execute({ ...c, limit: 200 })).length,
          });
        }
        return out;
      };

      await seedCommerce(app, PASSWORD);
      const first = await snapshot();
      await seedCommerce(app, PASSWORD);
      expect(await snapshot()).toEqual(first);

      for (const s of first as Array<{ products: string[]; places: unknown[]; reasons: number; balances: unknown[]; movements: number }>) {
        expect(s.products).toHaveLength(10);
        expect(s.places).toEqual([['Principal', true]]);
        expect(s.reasons).toBe(10);
        expect(s.balances).toHaveLength(10);
        expect(s.movements).toBe(10);
      }
    } finally {
      await app.close();
    }
  });

  it('se niega a correr con NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedCommerce({} as never, PASSWORD)).rejects.toThrow(/NODE_ENV=production/);
  });
});
