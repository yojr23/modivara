import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Device } from '../../domain/devices/device.js';
import { DeviceAssignment } from '../../domain/devices/device-assignment.js';
import { DeviceAlreadyAssignedError, DuplicateError } from '../../domain/errors.js';
import { DiningTable } from '../../domain/tables/dining-table.js';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { PrismaDeviceAssignmentRepository } from './prisma-device-assignment-repository.js';
import { PrismaDeviceRepository } from './prisma-device-repository.js';
import { PrismaDiningTableRepository } from './prisma-dining-table-repository.js';

const db = hospitalityPrismaForTests();
const devices = new PrismaDeviceRepository(db);
const assignments = new PrismaDeviceAssignmentRepository(db);
const t = tenant();
const other = tenant();
const ana = '00000000-0000-7000-8000-00000000000a';
const bea = '00000000-0000-7000-8000-00000000000b';

const device = async (code: string, loc = t) => {
  const d = Device.create({ ...loc, code, createdBy: ana, now: new Date() });
  await devices.save(d);
  return d;
};
const table = async (label: string, loc = t) => {
  const x = DiningTable.create({ ...loc, label, createdBy: ana, now: new Date() });
  await new PrismaDiningTableRepository(db).save(x);
  return x;
};
const assign = async (deviceId: string, tableId: string, now = new Date(), by = ana) => {
  const a = DeviceAssignment.create({ ...t, deviceId, tableId, assignedBy: by, now });
  await assignments.save(a);
  return a;
};

beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

describe('PrismaDeviceRepository', () => {
  it('findActiveByCode acotado por local; código duplicado es DuplicateError', async () => {
    const d = await device('btn-01');
    expect((await devices.findActiveByCode({ ...t, code: 'btn-01' }))?.id).toBe(d.id);
    expect(await devices.findActiveByCode({ ...other, code: 'btn-01' })).toBeNull();
    expect(await devices.findById({ ...other, id: d.id })).toBeNull();
    await expect(device('btn-01')).rejects.toBeInstanceOf(DuplicateError);
    await expect(device('btn-01', other)).resolves.toBeDefined();
  });
});

describe('PrismaDeviceAssignmentRepository', () => {
  it('una mesa admite tres botones; un botón no entra en dos mesas', async () => {
    const m1 = await table('1');
    const m2 = await table('2');
    const b = await device('b1');
    await assign(b.id, m1.id);
    await expect(assign(b.id, m2.id)).rejects.toBeInstanceOf(DeviceAlreadyAssignedError);
    for (const code of ['b2', 'b3']) await assign((await device(code)).id, m1.id);
    expect(await assignments.listActiveByTable({ ...t, tableId: m1.id })).toHaveLength(3);
    expect(await assignments.listActiveByTable({ ...t, tableId: m2.id })).toHaveLength(0);
  });

  it('desasignar conserva el historial con quién cerró', async () => {
    const b = await device('b1');
    const a = await assign(b.id, (await table('1')).id);
    a.unassign(bea, new Date());
    await assignments.save(a);
    expect(await assignments.findActiveByDevice({ ...t, deviceId: b.id })).toBeNull();
    expect(await db.deviceAssignment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ assignedBy: ana, unassignedBy: bea });
  });

  it('reasignar cierra la anterior y abre la nueva en una sola transacción', async () => {
    const m1 = await table('1');
    const m2 = await table('2');
    const b = await device('b1');
    const first = await assign(b.id, m1.id);
    first.unassign(bea, new Date());
    const second = DeviceAssignment.create({ ...t, deviceId: b.id, tableId: m2.id, assignedBy: bea, now: new Date() });
    await assignments.reassign(first, second);
    expect((await assignments.findActiveByDevice({ ...t, deviceId: b.id }))?.tableId).toBe(m2.id);
    expect(await db.deviceAssignment.count({ where: { deviceId: b.id } })).toBe(2);
  });

  it('si la apertura falla, reasignar no deja la anterior cerrada (rollback)', async () => {
    const m1 = await table('1');
    const b = await device('b1');
    const first = await assign(b.id, m1.id);
    first.unassign(bea, new Date());
    // mesa de otro local: la FK compuesta rechaza la apertura
    const foreign = await table('9', other);
    const bad = DeviceAssignment.create({ ...t, deviceId: b.id, tableId: foreign.id, assignedBy: bea, now: new Date() });
    await expect(assignments.reassign(first, bad)).rejects.toThrow();
    expect((await assignments.findActiveByDevice({ ...t, deviceId: b.id }))?.tableId).toBe(m1.id);
  });

  it('¿qué mesa tenía el botón en el instante T?', async () => {
    const m1 = await table('1');
    const m2 = await table('2');
    const b = await device('b1');
    const t0 = new Date('2026-10-20T10:00:00Z');
    const t1 = new Date('2026-10-20T11:00:00Z');
    const first = await assign(b.id, m1.id, t0);
    first.unassign(ana, t1);
    const second = DeviceAssignment.create({ ...t, deviceId: b.id, tableId: m2.id, assignedBy: ana, now: t1 });
    await assignments.reassign(first, second);
    const at = (iso: string) => assignments.findAt({ ...t, deviceId: b.id, at: new Date(iso) }).then((a) => a?.tableId ?? null);
    expect(await at('2026-10-20T09:59:59Z')).toBeNull();
    expect(await at('2026-10-20T10:00:00Z')).toBe(m1.id);
    expect(await at('2026-10-20T10:59:59Z')).toBe(m1.id);
    expect(await at('2026-10-20T11:00:00Z')).toBe(m2.id);
    expect(await at('2027-01-01T00:00:00Z')).toBe(m2.id);
    expect(await assignments.findAt({ ...other, deviceId: b.id, at: t1 })).toBeNull();
  });
});
