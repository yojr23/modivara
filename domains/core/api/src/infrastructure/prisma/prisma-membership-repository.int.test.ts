import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { LocationMembership } from '../../domain/index.js';
import { PrismaMembershipRepository } from './prisma-membership-repository.js';

const db = corePrismaForTests();
const repo = new PrismaMembershipRepository(db);
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

async function world() {
  const sol = await seedOrganization(db, 'bar-sol');
  const luna = await seedOrganization(db, 'bar-luna');
  const location = await seedLocation(db, sol);
  const user = await seedUser(db, sol);
  const m = LocationMembership.create({ id: newId(), user, location, roles: ['staff', 'admin'] });
  await repo.save(m);
  return { sol, luna, location, user, m };
}

describe('PrismaMembershipRepository', () => {
  it('alta, findActive y listActiveByUser acotados por negocio', async () => {
    const { sol, luna, location, user, m } = await world();
    const ref = { organizationId: sol.id, userId: user.id, locationId: location.id };
    expect(new Set((await repo.findActive(ref))?.roles)).toEqual(new Set(['staff', 'admin']));
    expect((await repo.listActiveByUser({ organizationId: sol.id, userId: user.id })).map((x) => x.id)).toEqual([m.id]);
    expect(await repo.findActive({ ...ref, organizationId: luna.id })).toBeNull();
    expect(await repo.listActiveByUser({ organizationId: luna.id, userId: user.id })).toEqual([]);
  });

  it('cambia roles y desactivar la saca de las activas', async () => {
    const { sol, location, user, m } = await world();
    m.setRoles(['inventory']);
    await repo.save(m);
    expect((await repo.findActive({ organizationId: sol.id, userId: user.id, locationId: location.id }))?.roles).toEqual(['inventory']);
    m.deactivate(new Date());
    await repo.save(m);
    expect(await repo.findActive({ organizationId: sol.id, userId: user.id, locationId: location.id })).toBeNull();
    expect(await repo.listActiveByUser({ organizationId: sol.id, userId: user.id })).toEqual([]);
  });

  it('segunda membresía activa del mismo usuario y local es ConflictError', async () => {
    const { location, user } = await world();
    await expect(repo.save(LocationMembership.create({ id: newId(), user, location, roles: ['staff'] }))).rejects.toBeInstanceOf(ConflictError);
  });
});
