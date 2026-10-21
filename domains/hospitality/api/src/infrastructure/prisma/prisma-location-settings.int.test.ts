import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { PrismaLocationSettingsRepository } from './prisma-location-settings-repository.js';

const db = hospitalityPrismaForTests();
const t = tenant();
const repo = new PrismaLocationSettingsRepository(db);
beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

describe('PrismaLocationSettingsRepository (F2-08)', () => {
  it('sin fila devuelve los valores por defecto; con fila, la de su local', async () => {
    expect(await repo.get(t)).toEqual({ callVisibility: 'all' });
    await db.locationSettings.create({ data: { ...t, callVisibility: 'all' } });
    expect(await repo.get(t)).toEqual({ callVisibility: 'all' });
    expect(await repo.get(tenant())).toEqual({ callVisibility: 'all' });
  });
});
