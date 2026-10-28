import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapPlatform, CoreModule, ProvisionOrganization } from '@modivara/core-api';
import { GatewayPressAdapter, GetConnectivity, HospitalityModule, ListDevices, ListTables, ListZones } from '@modivara/hospitality-api';
import { seedCore } from './core.js';
import { seedHospitality } from './hospitality.js';
import { resetBoth } from './testing.js';

// F2-xx: el seed de hospitality se puede repetir y la clave del gateway sale una sola vez. Requiere db-test.
const CORE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
const HOSPITALITY_URL = 'postgresql://hospitality_app:test@127.0.0.1:55432/modivara_test?schema=hospitality';
@Module({ imports: [CoreModule.forRoot({ databaseUrl: CORE_URL }), HospitalityModule.forRoot({ databaseUrl: HOSPITALITY_URL })] })
class SeedTestModule {}

const PASSWORD = 'Secret123';
describe('seed:hospitality', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('crea mesas, gateway y botones; repetirlo no duplica nada ni vuelve a mostrar la clave', async () => {
    const app = await NestFactory.createApplicationContext(SeedTestModule, { logger: false });
    try {
      await resetBoth(app);
      await seedCore(app, PASSWORD);
      const lines: string[] = [];
      await seedHospitality(app, PASSWORD, (l) => lines.push(l));
      expect(lines).toHaveLength(2); // una clave por gateway (Bar Demo y Pisos)
      const key = /^SIM_GATEWAY_KEY=(\S+)/.exec(lines[0]!)![1]!; // la primera es la de Bar Demo

      await seedHospitality(app, PASSWORD, (l) => lines.push(l));
      expect(lines).toHaveLength(2); // la segunda corrida no imprime la clave

      const root = await app.get(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: PASSWORD });
      const ctx = async (slug: string) => {
        const { organization, locations } = await app.get(ProvisionOrganization).execute({
          actor: root, slug, name: slug, locations: [{ name: 'Principal' }], modules: ['hospitality'],
        });
        return { organizationId: organization.id, locationId: locations[0]!.id };
      };
      const demo = await ctx('bar-demo');
      const tables = await app.get(ListTables).execute(demo);
      expect(tables).toHaveLength(15);
      expect(tables.every((t) => t.zoneName === null)).toBe(true);
      expect((await app.get(GetConnectivity).execute(demo)).gateways).toHaveLength(1);
      const devices = await app.get(ListDevices).execute(demo);
      expect(devices.map((d) => d.device.code).sort()).toEqual(Array.from({ length: 15 }, (_, i) => `btn-${String(i + 1).padStart(2, '0')}`));
      expect(devices.every((d) => d.tableId !== null)).toBe(true);
      expect(new Set(devices.map((d) => d.tableId)).size).toBe(15);
      // La clave impresa autentica al gateway creado por el seed.
      expect((await app.get(GatewayPressAdapter).authenticate(key)).locationId).toBe(demo.locationId);

      const pisos = await ctx('bar-demo-pisos');
      expect((await app.get(ListZones).execute(pisos)).map((z) => z.name)).toEqual(['Terraza', '2º piso']);
      const labels = (await app.get(ListTables).execute(pisos)).map((v) => `${v.zoneName}/${v.table.label}`);
      expect(labels).toHaveLength(6);
      expect(labels).toContain('Terraza/Mesa 1');
      expect(labels).toContain('2º piso/Mesa 1');
      expect((await app.get(GetConnectivity).execute(pisos)).gateways).toHaveLength(1);
      const pisosDevices = await app.get(ListDevices).execute(pisos);
      expect(pisosDevices.map((d) => d.device.code).sort()).toEqual(Array.from({ length: 6 }, (_, i) => `p-btn-${String(i + 1).padStart(2, '0')}`));
      expect(pisosDevices.every((d) => d.tableId !== null)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('se niega a correr con NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(seedHospitality({} as never, PASSWORD, () => undefined)).rejects.toThrow(/NODE_ENV=production/);
  });
});
