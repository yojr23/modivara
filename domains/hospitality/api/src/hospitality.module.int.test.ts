import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CORE_ACCESS_PORT, newId, type CoreAccessPort } from '@modivara/core-contracts';
import { CreateGateway, CreateTable, CreateZone, GatewayPressAdapter, HospitalityModule, ListActiveCalls, RegisterButtonPress } from './index.js';
import { hospitalityPrismaForTests, resetHospitality, TEST_HOSPITALITY_DATABASE_URL, tenant } from './testing/integration.js';

const t = tenant();
const actorUserId = newId();
const core: CoreAccessPort = {
  getLocation: async (id) => (id === t.locationId ? { id, organizationId: t.organizationId, timezone: 'America/Bogota', active: true } : null),
};

// Sustituto de CoreModule (global y exporta CORE_ACCESS_PORT): hospitality no puede importar core-api.
@Global()
@Module({ providers: [{ provide: CORE_ACCESS_PORT, useValue: core }], exports: [CORE_ACCESS_PORT] })
class FakeCoreModule {}

const db = hospitalityPrismaForTests();
beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

describe('HospitalityModule.forRoot', () => {
  it('liga puertos con adaptadores Prisma, provee los casos de uso y cierra el cliente al destruirse', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeCoreModule, HospitalityModule.forRoot({ databaseUrl: TEST_HOSPITALITY_DATABASE_URL })],
    }).compile();
    await moduleRef.init();

    const zone = await moduleRef.get(CreateZone).execute({ ...t, actorUserId, name: 'Terraza' });
    const table = await moduleRef.get(CreateTable).execute({ ...t, actorUserId, label: '5', zoneId: zone.id });
    const { gateway, plainKey } = await moduleRef.get(CreateGateway).execute({ ...t, actorUserId, name: 'Barra' });
    expect((await moduleRef.get(GatewayPressAdapter).authenticate(plainKey)).id).toBe(gateway.id);
    expect(await moduleRef.get(ListActiveCalls).execute({ ...t, actorUserId, permissions: new Set() })).toEqual([]);
    expect(moduleRef.get(RegisterButtonPress)).toBeDefined();
    expect(await db.diningTable.count({ where: { id: table.id } })).toBe(1);

    await moduleRef.close(); // onModuleDestroy desconecta el cliente propio
  });

  it('sin URL falla con un mensaje claro', async () => {
    const saved = process.env.HOSPITALITY_DATABASE_URL;
    delete process.env.HOSPITALITY_DATABASE_URL;
    try {
      await expect(Test.createTestingModule({ imports: [FakeCoreModule, HospitalityModule.forRoot()] }).compile()).rejects.toThrow(/HOSPITALITY_DATABASE_URL/);
    } finally {
      if (saved !== undefined) process.env.HOSPITALITY_DATABASE_URL = saved;
    }
  });
});
