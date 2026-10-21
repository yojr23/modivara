import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DuplicateError } from '../../domain/errors.js';
import { DiningTable } from '../../domain/tables/dining-table.js';
import { Zone } from '../../domain/tables/zone.js';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { PrismaDiningTableRepository } from './prisma-dining-table-repository.js';
import { PrismaZoneRepository } from './prisma-zone-repository.js';

const db = hospitalityPrismaForTests();
const zones = new PrismaZoneRepository(db);
const tables = new PrismaDiningTableRepository(db);
const t = tenant();
const other = tenant();
const by = '00000000-0000-7000-8000-000000000001';
const now = () => new Date();

const zone = async (name: string, position = 0, loc = t) => {
  const z = Zone.create({ ...loc, name, position, createdBy: by, now: now() });
  await zones.save(z);
  return z;
};
const table = (label: string, zoneId: string | null = null, position = 0, loc = t) => {
  const x = DiningTable.create({ ...loc, label, zoneId, position, createdBy: by, now: now() });
  return tables.save(x).then(() => x);
};

beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

describe('PrismaZoneRepository', () => {
  it('lista por position y acotada por tenant; findById acotado', async () => {
    const b = await zone('B', 2);
    const a = await zone('A', 1);
    await zone('Ajena', 0, other);
    expect((await zones.listByLocation(t)).map((z) => z.name)).toEqual(['A', 'B']);
    expect(await zones.findById({ ...t, id: a.id })).not.toBeNull();
    expect(await zones.findById({ ...other, id: b.id })).toBeNull();
  });

  it('findActiveByName sin distinguir mayúsculas ni tratar % como comodín', async () => {
    await zone('Terraza');
    expect(await zones.findActiveByName({ ...t, name: ' TERRAZA ' })).not.toBeNull();
    expect(await zones.findActiveByName({ ...t, name: 'Terr%' })).toBeNull();
  });

  it('nombre duplicado es DuplicateError', async () => {
    await zone('Terraza');
    await expect(zone('terraza')).rejects.toBeInstanceOf(DuplicateError);
  });
});

describe('PrismaDiningTableRepository', () => {
  it('mismo número en zonas distintas sí; en la misma zona o dos sin zona es DuplicateError', async () => {
    const z1 = await zone('Terraza');
    const z2 = await zone('Piso 2');
    await table('5', z1.id);
    await expect(table('5', z2.id)).resolves.toBeDefined();
    await expect(table('5', z1.id)).rejects.toBeInstanceOf(DuplicateError);
    await table('Barra 1');
    await expect(table('barra 1')).rejects.toBeInstanceOf(DuplicateError);
  });

  it('findActiveByLabel distingue zona y sin zona', async () => {
    const z = await zone('Terraza');
    await table('5', z.id);
    expect(await tables.findActiveByLabel({ ...t, zoneId: z.id, label: '5' })).not.toBeNull();
    expect(await tables.findActiveByLabel({ ...t, zoneId: null, label: '5' })).toBeNull();
  });

  it('lista por position (incluye inactivas) y acotada por tenant', async () => {
    await table('C', null, 3);
    await table('A', null, 1);
    const b = await table('B', null, 2);
    await table('X', null, 0, other);
    b.deactivate(by, now());
    await tables.save(b);
    expect((await tables.listByLocation(t)).map((x) => x.label)).toEqual(['A', 'B', 'C']);
    expect(await tables.findById({ ...other, id: b.id })).toBeNull();
  });

  it('desactivar libera la etiqueta y renombrar persiste', async () => {
    const a = await table('7');
    a.deactivate(by, now());
    await tables.save(a);
    expect((await tables.findById({ ...t, id: a.id }))?.isActive).toBe(false);
    expect(await tables.findActiveByLabel({ ...t, zoneId: null, label: '7' })).toBeNull();
    const again = await table('7');
    again.rename('8', by, now());
    await tables.save(again);
    expect((await tables.findById({ ...t, id: again.id }))?.label).toBe('8');
  });

  it('renombrar a una etiqueta tomada es DuplicateError', async () => {
    await table('1');
    const two = await table('2');
    two.rename('1', by, now());
    await expect(tables.save(two)).rejects.toBeInstanceOf(DuplicateError);
  });
});
