import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictError, newId } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore, seedLocation, seedOrganization, seedUser } from '../../testing/integration.js';
import { PrismaAuditLog } from './prisma-audit-log.js';

const db = corePrismaForTests();
beforeEach(() => resetCore(db));
afterAll(() => db.$disconnect());

describe('PrismaAuditLog', () => {
  it('registra la entrada con sus detalles', async () => {
    const sol = await seedOrganization(db, 'bar-sol');
    const actor = await seedUser(db, sol);
    const occurredAt = new Date('2026-01-02T03:04:05Z');
    await new PrismaAuditLog(db).record({
      id: newId(), organizationId: sol.id, actorUserId: actor.id, action: 'user.created',
      targetType: 'user', targetId: actor.id, details: { username: 'ana', roles: ['staff'] }, occurredAt,
    });
    const rows = await db.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: sol.id, action: 'user.created', targetId: actor.id, details: { username: 'ana', roles: ['staff'] } });
    expect(rows[0]?.occurredAt.getTime()).toBe(occurredAt.getTime());
  });
});
