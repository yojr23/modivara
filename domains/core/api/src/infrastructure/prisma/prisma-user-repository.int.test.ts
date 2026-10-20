import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { PrismaUserRepository } from './prisma-user-repository.js';

const db = corePrismaForTests();
const repo = new PrismaUserRepository(db);
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

describe('PrismaUserRepository', () => {
  it('alta y búsqueda por (negocio, username) acotada por tenant', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const luna = await seedOrganization(db, 'bar-luna');
    const u = await seedUser(db, sol, 'ana');
    expect((await repo.findActiveByUsername({ organizationId: sol.id, username: 'ana' }))?.id).toBe(u.id);
    expect(await repo.findActiveByUsername({ organizationId: luna.id, username: 'ana' })).toBeNull();
    expect(await repo.findById({ id: u.id, organizationId: luna.id })).toBeNull();
    expect((await repo.findById({ id: u.id, organizationId: sol.id }))?.displayName).toBe('ana');
    expect((await repo.findByIdForSession({ id: u.id }))?.organizationId).toBe(sol.id);
  });

  it('username duplicado activo es ConflictError; desactivar libera el username', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const ana = await seedUser(db, sol, 'ana');
    await expect(seedUser(db, sol, 'ana')).rejects.toBeInstanceOf(ConflictError);
    ana.deactivate(new Date());
    await repo.save(ana);
    expect(await repo.findActiveByUsername({ organizationId: sol.id, username: 'ana' })).toBeNull();
    const again = await seedUser(db, sol, 'ana');
    expect((await repo.findActiveByUsername({ organizationId: sol.id, username: 'ana' }))?.id).toBe(again.id);
  });

  it('persiste contador de fallos y cambio de contraseña', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const u = await seedUser(db, sol);
    const now = new Date();
    u.registerFailedLogin(now);
    u.changePassword('nuevo', now);
    u.registerFailedLogin(now);
    await repo.save(u);
    const r = await repo.findById({ id: u.id, organizationId: sol.id });
    expect(r).toMatchObject({ passwordHash: 'nuevo', failedLoginCount: 1 });
    expect(r?.failedLoginWindowStart?.getTime()).toBe(now.getTime());
  });

  describe('withLoginLock', () => {
    it('entrega el usuario, o null si está desactivado o es de otro negocio', async () => {
      const sol = await seedOrganization(db, 'bar-sol');
      const luna = await seedOrganization(db, 'bar-luna');
      const u = await seedUser(db, sol);
      expect(await repo.withLoginLock({ id: u.id, organizationId: sol.id }, async (tx) => tx.user?.id)).toBe(u.id);
      expect(await repo.withLoginLock({ id: u.id, organizationId: luna.id }, async (tx) => tx.user)).toBeNull();
      u.deactivate(new Date());
      await repo.save(u);
      expect(await repo.withLoginLock({ id: u.id, organizationId: sol.id }, async (tx) => tx.user)).toBeNull();
    });

    it('dos fallos simultáneos suman 2 (SELECT … FOR UPDATE)', async () => {
      const sol = await seedOrganization(db, 'bar-sol');
      const u = await seedUser(db, sol);
      const fail = () =>
        repo.withLoginLock({ id: u.id, organizationId: sol.id }, async (tx) => {
          const user = tx.user!;
          // Pausa dentro de la sección crítica: sin bloqueo ambos leerían 0 y el contador quedaría en 1.
          await new Promise((r) => setTimeout(r, 100));
          user.registerFailedLogin(new Date());
          await tx.save(user);
        });
      await Promise.all([fail(), fail()]);
      expect((await repo.findById({ id: u.id, organizationId: sol.id }))?.failedLoginCount).toBe(2);
    });

    it('si el trabajo lanza, hace rollback', async () => {
      const sol = await seedOrganization(db, 'bar-sol');
      const u = await seedUser(db, sol);
      await expect(
        repo.withLoginLock({ id: u.id, organizationId: sol.id }, async (tx) => {
          tx.user!.registerFailedLogin(new Date());
          await tx.save(tx.user!);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await repo.findById({ id: u.id, organizationId: sol.id }))?.failedLoginCount).toBe(0);
    });
  });
});
