import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { Organization } from '../../domain/index.js';
import { PrismaOrganizationRepository } from './prisma-organization-repository.js';

const db = corePrismaForTests();
const repo = new PrismaOrganizationRepository(db);
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

describe('PrismaOrganizationRepository', () => {
  it('alta y búsqueda por id y por slug', async () => {
    const o = await seedOrganization(db, 'bar-sol');
    expect((await repo.findById({ id: o.id }))?.slug).toBe('bar-sol');
    expect((await repo.findBySlug({ slug: 'bar-sol' }))?.id).toBe(o.id);
    expect(await repo.findBySlug({ slug: 'otro' })).toBeNull();
    expect(await repo.findById({ id: newId() })).toBeNull();
  });

  it('desactivar persiste y el slug no se reutiliza', async () => {
    const o = await seedOrganization(db, 'bar-sol');
    o.deactivate(new Date());
    await repo.save(o);
    expect((await repo.findById({ id: o.id }))?.isActive).toBe(false);
    await expect(repo.save(Organization.create({ id: newId(), slug: 'bar-sol', name: 'Otro' }))).rejects.toBeInstanceOf(ConflictError);
  });

  it('una sola organización de plataforma: la segunda es ConflictError', async () => {
    await seedOrganization(db, 'labs', { isPlatform: true });
    await expect(seedOrganization(db, 'labs-2', { isPlatform: true })).rejects.toBeInstanceOf(ConflictError);
  });
});
