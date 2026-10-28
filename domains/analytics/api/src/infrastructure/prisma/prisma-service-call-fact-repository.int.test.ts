import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { ServiceCallFact } from '../../domain/index.js';
import { analyticsPrismaForTests, resetAnalytics, tenant } from '../../testing/integration.js';
import { PrismaServiceCallFactRepository } from './prisma-service-call-fact-repository.js';

const db = analyticsPrismaForTests();
const repo = new PrismaServiceCallFactRepository(db);
const t = tenant();
beforeEach(() => resetAnalytics(db));
afterAll(() => db.$disconnect());

const fact = (createdAt: string, extra: { zoneId?: string | null; tableId?: string; loc?: typeof t } = {}) =>
  ServiceCallFact.create(extra.loc ?? t, {
    service_call_id: newId(), table_id: extra.tableId ?? newId(), table_label: 'Mesa 1',
    zone_id: extra.zoneId === undefined ? newId() : extra.zoneId, zone_name: extra.zoneId === null ? null : 'Terraza',
    call_type: 'attention', created_at: createdAt,
  });
const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });

describe('PrismaServiceCallFactRepository', () => {
  it('save inserta y luego reemplaza por id; findById respeta fechas y nulos', async () => {
    const f = fact('2026-10-01T10:00:00.000Z', { zoneId: null });
    await repo.save(f);
    expect((await repo.findById(f.serviceCallId))?.snapshot).toEqual(f.snapshot);
    f.applyAcknowledged({ service_call_id: f.serviceCallId, acknowledged_at: '2026-10-01T10:01:00.000Z', acknowledged_by: newId(), press_count: 3 });
    await repo.save(f);
    const again = await repo.findById(f.serviceCallId);
    expect(again?.snapshot).toEqual(f.snapshot);
    expect(again?.snapshot).toMatchObject({ pressCount: 3, zoneId: null });
    expect(await db.serviceCallFact.count()).toBe(1);
    expect(await repo.findById(newId())).toBeNull();
  });

  it('findCreatedBetween filtra por local, rango [from, to), zona y mesa', async () => {
    const zone = newId();
    const table = newId();
    const inside = fact('2026-10-01T10:00:00.000Z', { zoneId: zone, tableId: table });
    const atFrom = fact('2026-10-01T00:00:00.000Z');
    const atTo = fact('2026-10-02T00:00:00.000Z');
    const otherLoc = fact('2026-10-01T10:00:00.000Z', { loc: tenant() });
    for (const f of [inside, atFrom, atTo, otherLoc]) await repo.save(f);
    const q = { ...t, range: range('2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z') };
    const ids = async (x: Parameters<typeof repo.findCreatedBetween>[0]) => (await repo.findCreatedBetween(x)).map((f) => f.serviceCallId).sort();
    expect(await ids(q)).toEqual([inside.serviceCallId, atFrom.serviceCallId].sort());
    expect(await ids({ ...q, zoneId: zone })).toEqual([inside.serviceCallId]);
    expect(await ids({ ...q, tableId: table })).toEqual([inside.serviceCallId]);
    expect(await ids({ ...q, zoneId: newId() })).toEqual([]);
  });

  it('clear vacía la tabla', async () => {
    await repo.save(fact('2026-10-01T10:00:00.000Z'));
    await repo.clear();
    expect(await db.serviceCallFact.count()).toBe(0);
  });
});
