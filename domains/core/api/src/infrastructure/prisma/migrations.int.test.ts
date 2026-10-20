import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { corePrismaForTests, resetCore } from '../../testing/integration.js';

// La base garantiza las invariantes de core aunque falle la aplicación (DATA-001 §2, F1-01).
const db = corePrismaForTests();
const sql = (q: string) => db.$executeRawUnsafe(q);

beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

const org = (slug: string, platform = false) =>
  db.organization.create({ data: { slug, name: slug, isPlatform: platform } });

describe('migración core 0001', () => {
  it('slug único para siempre, aunque el negocio se desactive', async () => {
    const a = await org('bar-sol');
    await db.organization.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(org('bar-sol')).rejects.toThrow();
  });

  it('formato de slug y username en la base', async () => {
    await expect(org('Bar Sol')).rejects.toThrow();
    await expect(org('ab')).rejects.toThrow();
    const o = await org('bar-luna');
    await expect(
      db.appUser.create({ data: { organizationId: o.id, username: 'Ana', displayName: 'Ana', passwordHash: 'x' } }),
    ).rejects.toThrow();
  });

  it('una sola organización de plataforma', async () => {
    await org('labs', true);
    await expect(org('otra-labs', true)).rejects.toThrow();
  });

  it('username único solo entre usuarios activos del negocio', async () => {
    const o = await org('bar-luna');
    const data = { organizationId: o.id, username: 'ana', displayName: 'Ana', passwordHash: 'x' };
    const ana = await db.appUser.create({ data });
    await expect(db.appUser.create({ data })).rejects.toThrow();
    await db.appUser.update({ where: { id: ana.id }, data: { deactivatedAt: new Date() } });
    await expect(db.appUser.create({ data })).resolves.toBeDefined();
  });

  it('membresía exige usuario y local del mismo negocio, y al menos un rol', async () => {
    const a = await org('bar-luna');
    const b = await org('bar-sol');
    const user = await db.appUser.create({ data: { organizationId: a.id, username: 'ana', displayName: 'Ana', passwordHash: 'x' } });
    const foreign = await db.location.create({ data: { organizationId: b.id, name: 'Centro' } });
    const own = await db.location.create({ data: { organizationId: a.id, name: 'Centro' } });

    await expect(
      db.locationMembership.create({ data: { organizationId: a.id, userId: user.id, locationId: foreign.id, roles: ['staff'] } }),
    ).rejects.toThrow();
    await expect(
      db.locationMembership.create({ data: { organizationId: a.id, userId: user.id, locationId: own.id, roles: [] } }),
    ).rejects.toThrow();
    await expect(
      db.locationMembership.create({ data: { organizationId: a.id, userId: user.id, locationId: own.id, roles: ['staff'] } }),
    ).resolves.toBeDefined();
  });

  it('nombre de local único entre activos sin distinguir mayúsculas', async () => {
    const o = await org('bar-luna');
    await db.location.create({ data: { organizationId: o.id, name: 'Centro' } });
    await expect(db.location.create({ data: { organizationId: o.id, name: 'CENTRO' } })).rejects.toThrow();
  });

  it('ids UUIDv7 por defecto en la base', async () => {
    const o = await org('bar-luna');
    expect(o.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(await sql('SELECT 1')).toBe(1);
  });
});
