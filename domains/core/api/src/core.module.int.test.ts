import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CORE_ACCESS_PORT, type CoreAccessPort } from '@modivara/core-contracts';
import { CoreModule } from './core.module.js';
import { Login } from './application/index.js';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, TEST_CORE_DATABASE_URL } from './testing/integration.js';
import { PrismaLocationRepository, PrismaOrganizationRepository } from './infrastructure/prisma/index.js';

// CoreAccessPort en proceso, resuelto por su token desde un módulo Nest real (F1-08).
const db = corePrismaForTests();
let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>;
let access: CoreAccessPort;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [CoreModule.forRoot({ databaseUrl: TEST_CORE_DATABASE_URL })] }).compile();
  access = moduleRef.get<CoreAccessPort>(CORE_ACCESS_PORT);
});
beforeEach(() => resetCore(db));
afterAll(async () => {
  await moduleRef.close();
  await db.$disconnect();
});

describe('CoreModule + CoreAccessPort', () => {
  it('devuelve la zona horaria y el estado del local', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const l = await seedLocation(db, sol, 'Centro', 'America/Mexico_City');
    expect(await access.getLocation(l.id)).toEqual({ id: l.id, organizationId: sol.id, timezone: 'America/Mexico_City', active: true });
  });

  it('local inexistente: null', async () => {
    expect(await access.getLocation('0198f0a0-0000-7000-8000-000000000000')).toBeNull();
  });

  it('local desactivado o de negocio desactivado: active false', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const luna = await seedOrganization(db, 'bar-luna');
    const off = await seedLocation(db, sol, 'Centro');
    const ofOffOrg = await seedLocation(db, luna, 'Centro');
    off.deactivate(new Date());
    await new PrismaLocationRepository(db).save(off);
    luna.deactivate(new Date());
    await new PrismaOrganizationRepository(db).save(luna);
    expect((await access.getLocation(off.id))?.active).toBe(false);
    expect((await access.getLocation(ofOffOrg.id))?.active).toBe(false);
  });

  it('provee los casos de uso cableados', () => {
    expect(moduleRef.get(Login)).toBeInstanceOf(Login);
  });
});
