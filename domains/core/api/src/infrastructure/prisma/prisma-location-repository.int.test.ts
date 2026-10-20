import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { PrismaLocationRepository } from './prisma-location-repository.js';
import { PrismaOrganizationRepository } from './prisma-organization-repository.js';

const db = corePrismaForTests();
const repo = new PrismaLocationRepository(db);
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

describe('PrismaLocationRepository', () => {
  it('findById acotado por negocio', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const luna = await seedOrganization(db, 'bar-luna');
    const l = await seedLocation(db, sol, 'Centro', 'America/Mexico_City');
    const found = await repo.findById({ id: l.id, organizationId: sol.id });
    expect(found?.timezone).toBe('America/Mexico_City');
    expect(await repo.findById({ id: l.id, organizationId: luna.id })).toBeNull();
  });

  it('findByIdWithOrganization: estado del negocio, con y sin organizationId', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const luna = await seedOrganization(db, 'bar-luna');
    const l = await seedLocation(db, sol);
    expect(await repo.findByIdWithOrganization({ id: l.id })).toMatchObject({ organizationActive: true });
    expect(await repo.findByIdWithOrganization({ id: l.id, organizationId: sol.id })).not.toBeNull();
    expect(await repo.findByIdWithOrganization({ id: l.id, organizationId: luna.id })).toBeNull();
    sol.deactivate(new Date());
    await new PrismaOrganizationRepository(db).save(sol);
    expect((await repo.findByIdWithOrganization({ id: l.id }))?.organizationActive).toBe(false);
  });

  it('desactivar persiste; nombre duplicado entre activos es ConflictError', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const l = await seedLocation(db, sol, 'Centro');
    await expect(seedLocation(db, sol, 'CENTRO')).rejects.toBeInstanceOf(ConflictError);
    l.deactivate(new Date());
    await repo.save(l);
    expect((await repo.findById({ id: l.id, organizationId: sol.id }))?.isActive).toBe(false);
    await expect(seedLocation(db, sol, 'Centro')).resolves.toBeDefined();
  });
});
