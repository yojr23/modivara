import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';

// La base garantiza las invariantes de hospitality aunque falle la aplicación (DATA-001 §3, F2-01).
const db = hospitalityPrismaForTests();
beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

const t = tenant();
const other = tenant();
const zone = (name: string, loc = t) => db.zone.create({ data: { ...loc, name } });
const table = (label: string, zoneId: string | null = null, loc = t) => db.diningTable.create({ data: { ...loc, label, zoneId } });
const device = (code: string, loc = t) => db.device.create({ data: { ...loc, code } });
const gateway = (loc = t) => db.gateway.create({ data: { ...loc, name: 'gw', keyHash: Buffer.from(newId()) } });
const assign = (deviceId: string, tableId: string, loc = t) =>
  db.deviceAssignment.create({ data: { ...loc, deviceId, tableId, assignedBy: newId() } });
const call = (tableId: string, data: Record<string, unknown> = {}, loc = t) =>
  db.serviceCall.create({ data: { ...loc, tableId, ...data } });

describe('migración hospitality 0001', () => {
  it('nombre de zona único entre activas, sin distinguir mayúsculas', async () => {
    const a = await zone('Terraza');
    await expect(zone('TERRAZA')).rejects.toThrow();
    await expect(zone('Terraza', other)).resolves.toBeDefined();
    await db.zone.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(zone('Terraza')).resolves.toBeDefined();
  });

  it('misma etiqueta de mesa en zonas distintas pasa; en la misma zona o dos "sin zona" falla', async () => {
    const terraza = await zone('Terraza');
    const piso2 = await zone('2º piso');
    await table('5', terraza.id);
    await expect(table('5', piso2.id)).resolves.toBeDefined();
    await expect(table('5', terraza.id)).rejects.toThrow();
    await expect(table('MESA 1')).resolves.toBeDefined();
    await expect(table('mesa 1')).rejects.toThrow();
  });

  it('desactivar una mesa libera su etiqueta', async () => {
    const a = await table('7');
    await db.diningTable.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(table('7')).resolves.toBeDefined();
  });

  it('código de botón único entre activos del local', async () => {
    await device('btn-01');
    await expect(device('btn-01')).rejects.toThrow();
    await expect(device('btn-01', other)).resolves.toBeDefined();
  });

  it('un botón no puede tener dos asignaciones activas; una mesa admite tres botones', async () => {
    const m1 = await table('1');
    const m2 = await table('2');
    const b = await device('btn-01');
    await assign(b.id, m1.id);
    await expect(assign(b.id, m2.id)).rejects.toThrow();
    for (const code of ['b2', 'b3']) await assign((await device(code)).id, m1.id);
    expect(await db.deviceAssignment.count({ where: { tableId: m1.id, unassignedAt: null } })).toBe(3);
  });

  it('cerrar una asignación exige unassigned_at y unassigned_by juntos', async () => {
    const a = await assign((await device('b')).id, (await table('1')).id);
    await expect(db.deviceAssignment.update({ where: { id: a.id }, data: { unassignedAt: new Date() } })).rejects.toThrow();
    await expect(db.deviceAssignment.update({ where: { id: a.id }, data: { unassignedBy: newId() } })).rejects.toThrow();
    await expect(
      db.deviceAssignment.update({ where: { id: a.id }, data: { unassignedAt: new Date(), unassignedBy: newId() } }),
    ).resolves.toBeDefined();
  });

  it('el estado de la solicitud no puede contradecir sus fechas', async () => {
    const m = await table('1');
    const user = newId();
    const now = new Date();
    await expect(call(m.id, { status: 'in_progress' })).rejects.toThrow();
    await expect(call(m.id, { status: 'completed', acknowledgedAt: now, acknowledgedBy: user })).rejects.toThrow();
    await expect(call(m.id, { status: 'pending', acknowledgedAt: now, acknowledgedBy: user })).rejects.toThrow();
    await expect(call(m.id, { status: 'in_progress', acknowledgedAt: now })).rejects.toThrow(); // sin actor
    await expect(call(m.id, { status: 'in_progress', acknowledgedAt: now, acknowledgedBy: user })).resolves.toBeDefined();
  });

  it('press_count >= 1', async () => {
    await expect(call((await table('1')).id, { pressCount: 0 })).rejects.toThrow();
  });

  it('una sola solicitud activa por mesa y tipo; al completarse se libera', async () => {
    const m = await table('1');
    const first = await call(m.id);
    await expect(call(m.id)).rejects.toThrow();
    // Hoy hay un solo call_type ('attention'): la invariante se prueba con el índice y la mesa, no con un segundo tipo.
    await expect(call((await table('2')).id)).resolves.toBeDefined();
    const now = new Date();
    await db.serviceCall.update({
      where: { id: first.id },
      data: { status: 'completed', acknowledgedAt: now, acknowledgedBy: newId(), completedAt: now, completedBy: newId() },
    });
    await expect(call(m.id)).resolves.toBeDefined();
  });

  it('una transición exige actor o evento de botón', async () => {
    const c = await call((await table('1')).id);
    const base = { ...t, serviceCallId: c.id, action: 'create' as const, toStatus: 'pending' as const };
    await expect(db.serviceCallTransition.create({ data: base })).rejects.toThrow();
    await expect(db.serviceCallTransition.create({ data: { ...base, deviceEventId: newId() } })).resolves.toBeDefined();
    await expect(db.serviceCallTransition.create({ data: { ...base, actorUserId: newId() } })).resolves.toBeDefined();
  });

  it('FK compuestas: no se mezclan filas de locales distintos', async () => {
    const foreignZone = await zone('Z', other);
    const foreignTable = await table('1', null, other);
    const foreignDevice = await device('b', other);
    const foreignGateway = await gateway(other);
    const ownTable = await table('9');
    const ownDevice = await device('own');
    await expect(table('2', foreignZone.id)).rejects.toThrow();
    await expect(assign(ownDevice.id, foreignTable.id)).rejects.toThrow();
    await expect(assign(foreignDevice.id, ownTable.id)).rejects.toThrow();
    await expect(call(foreignTable.id)).rejects.toThrow();
    await expect(
      db.deviceEvent.create({
        data: { ...t, gatewayId: foreignGateway.id, deviceCode: 'x', transport: 'http', payload: {}, result: 'unknown_device', correlationId: newId() },
      }),
    ).rejects.toThrow();
  });
});
