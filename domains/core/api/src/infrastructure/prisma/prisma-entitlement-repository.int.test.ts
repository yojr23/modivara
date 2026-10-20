import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { Entitlement } from '../../domain/index.js';
import { PrismaEntitlementRepository } from './prisma-entitlement-repository.js';

const db = corePrismaForTests();
const repo = new PrismaEntitlementRepository(db);
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

describe('PrismaEntitlementRepository', () => {
  it('lista solo módulos habilitados del negocio, y find/save (upsert)', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const luna = await seedOrganization(db, 'bar-luna');
    await repo.save(Entitlement.create({ organizationId: sol.id, module: 'hospitality' }));
    await repo.save(Entitlement.create({ organizationId: sol.id, module: 'commerce', enabled: false }));
    await repo.save(Entitlement.create({ organizationId: luna.id, module: 'analytics' }));
    expect(await repo.listEnabledModules({ organizationId: sol.id })).toEqual(['hospitality']);

    const c = (await repo.find({ organizationId: sol.id, module: 'commerce' }))!;
    expect(c.enabled).toBe(false);
    c.setEnabled(true);
    await repo.save(c);
    expect((await repo.listEnabledModules({ organizationId: sol.id })).sort()).toEqual(['commerce', 'hospitality']);
    expect(await repo.find({ organizationId: luna.id, module: 'commerce' })).toBeNull();
  });
});
