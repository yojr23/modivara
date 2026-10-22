import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { AcknowledgeCall } from '../../application/acknowledge-call.js';
import { CompleteCall } from '../../application/complete-call.js';
import type { NormalizedPress } from '../../application/ports/index.js';
import { RegisterButtonPress } from '../../application/register-button-press.js';
import { Device } from '../../domain/devices/device.js';
import { DeviceAssignment } from '../../domain/devices/device-assignment.js';
import { Gateway } from '../../domain/devices/gateway.js';
import { ConcurrencyConflictError, InvalidTransitionError } from '../../domain/errors.js';
import { DiningTable } from '../../domain/tables/dining-table.js';
import { FakeCoreAccess, RecordingNotifications } from '../../testing/in-memory.js';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { PrismaButtonPressStore } from './prisma-button-press-store.js';
import { PrismaDeviceAssignmentRepository } from './prisma-device-assignment-repository.js';
import { PrismaDeviceRepository } from './prisma-device-repository.js';
import { PrismaDiningTableRepository } from './prisma-dining-table-repository.js';
import { PrismaGatewayRepository } from './prisma-gateway-repository.js';
import { PrismaServiceCallRepository } from './prisma-service-call-repository.js';
import { PrismaZoneRepository } from './prisma-zone-repository.js';

// F3-03 / F3-04: infraestructura real (PostgreSQL). Solo `Date` es falso: el pool de pg y las transacciones usan temporizadores reales.
const N = 20;
const db = hospitalityPrismaForTests();
const t = tenant();
const waiter = newId();
const core = new FakeCoreAccess();
core.add({ id: t.locationId, organizationId: t.organizationId, timezone: 'America/Bogota', active: true });
const calls = new PrismaServiceCallRepository(db);
const notifications = new RecordingNotifications();
const press = new RegisterButtonPress(
  core, new PrismaDeviceRepository(db), new PrismaDeviceAssignmentRepository(db), new PrismaDiningTableRepository(db),
  new PrismaZoneRepository(db), new PrismaButtonPressStore(db), notifications,
);
const acknowledge = new AcknowledgeCall(calls, notifications);
const complete = new CompleteCall(calls, notifications);

beforeEach(async () => {
  notifications.sent.length = 0;
  await resetHospitality(db);
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.$disconnect());

async function setup(buttons: number) {
  const { gateway } = Gateway.create({ ...t, name: 'gw', createdBy: waiter, now: new Date() });
  await new PrismaGatewayRepository(db).save(gateway);
  const table = DiningTable.create({ ...t, label: '5', createdBy: waiter, now: new Date() });
  await new PrismaDiningTableRepository(db).save(table);
  const codes: string[] = [];
  for (let i = 1; i <= buttons; i++) {
    const device = Device.create({ ...t, code: `btn-${i}`, createdBy: waiter, now: new Date() });
    await new PrismaDeviceRepository(db).save(device);
    await new PrismaDeviceAssignmentRepository(db).save(DeviceAssignment.create({ ...t, deviceId: device.id, tableId: table.id, assignedBy: waiter, now: new Date() }));
    codes.push(device.code);
  }
  const signal = (deviceCode: string): NormalizedPress => ({
    ...t, gatewayId: gateway.id, deviceCode, buttonKey: null, callType: 'attention', sentAt: null, transport: 'http', payload: { device_code: deviceCode },
  });
  return { codes, signal };
}

const action = (callId: string, actorUserId = waiter) => ({ ...t, actorUserId, callId });
const results = (outcomes: Array<{ result: string }>) => outcomes.map((o) => o.result).sort();

describe('F3-03 debounce con infraestructura real', () => {
  it('dos señales a 1 s: la segunda es debounced y press_count no cambia; a 4 s es repeat_press', async () => {
    const s = await setup(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    expect((await press.registerPress(s.signal('btn-1'))).result).toBe('call_created');
    vi.setSystemTime(new Date('2026-10-19T10:00:01Z'));
    expect((await press.registerPress(s.signal('btn-1'))).result).toBe('debounced');
    expect((await db.serviceCall.findFirstOrThrow()).pressCount).toBe(1);
    vi.setSystemTime(new Date('2026-10-19T10:00:04Z'));
    expect((await press.registerPress(s.signal('btn-1'))).result).toBe('repeat_press');
    expect((await db.serviceCall.findFirstOrThrow()).pressCount).toBe(2);
    expect(await db.deviceEvent.count()).toBe(3);
  });
});

describe(`F3-04 concurrencia (N=${N})`, () => {
  it('N botones distintos de la misma mesa a la vez: 1 llamado activo, press_count N, 1 transición create, 1 evento created', async () => {
    const s = await setup(N);
    const outcomes = await Promise.all(s.codes.map((c) => press.registerPress(s.signal(c))));
    expect(results(outcomes)).toEqual([...Array(N - 1).fill('repeat_press'), 'call_created'].sort());
    const rows = await db.serviceCall.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pressCount).toBe(N);
    expect(await db.serviceCallTransition.findMany()).toMatchObject([{ action: 'create', serviceCallId: rows[0]!.id }]);
    expect(await db.outboxEvent.findMany()).toMatchObject([{ eventType: 'hospitality.service_call.created', aggregateId: rows[0]!.id }]);
    expect(await db.deviceEvent.count()).toBe(N);
    expect(notifications.sent.filter((n) => n.change === 'created')).toHaveLength(1);
  });

  it('la misma señal N veces en paralelo: una cuenta, el resto debounced', async () => {
    const s = await setup(1);
    const outcomes = await Promise.all(Array.from({ length: N }, () => press.registerPress(s.signal('btn-1'))));
    expect(results(outcomes)).toEqual([...Array(N - 1).fill('debounced'), 'call_created'].sort());
    expect((await db.serviceCall.findFirstOrThrow()).pressCount).toBe(1);
    expect(await db.serviceCall.count()).toBe(1);
    expect(await db.serviceCallTransition.count()).toBe(1);
    expect(await db.outboxEvent.count()).toBe(1);
    expect(await db.deviceEvent.count()).toBe(N);
  });

  it('dos usuarios reconociendo a la vez: uno OK y el otro conflicto', async () => {
    const s = await setup(1);
    const id = (await press.registerPress(s.signal('btn-1'))).serviceCallId!;
    const settled = await Promise.allSettled([acknowledge.execute(action(id)), acknowledge.execute(action(id, newId()))]);
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // Según el orden de lectura, el perdedor choca al guardar (409 con estado actual) o ya lee `in_progress` (transición inválida, también 409).
    expect(rejected).toHaveLength(1);
    expect([ConcurrencyConflictError, InvalidTransitionError].some((E) => rejected[0]!.reason instanceof E)).toBe(true);
    expect(await db.serviceCallTransition.count({ where: { action: 'acknowledge' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: 'hospitality.service_call.acknowledged' } })).toBe(1);
  });

  it('dos usuarios con la misma lectura: el segundo guardado recibe el conflicto con el estado actual', async () => {
    const s = await setup(1);
    const id = (await press.registerPress(s.signal('btn-1'))).serviceCallId!;
    const [a, b] = await Promise.all([calls.findById({ ...t, id }), calls.findById({ ...t, id })]);
    a!.acknowledge(waiter, new Date());
    b!.acknowledge(newId(), new Date());
    const saves = await Promise.allSettled([calls.save(a!), calls.save(b!)]);
    const rejected = saves.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(saves.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConcurrencyConflictError);
    expect((rejected[0]!.reason as ConcurrencyConflictError).current?.status).toBe('in_progress');
    expect(await db.serviceCallTransition.count({ where: { action: 'acknowledge' } })).toBe(1);
  });

  it('reconocer y finalizar cruzados: un solo camino válido y sin transiciones duplicadas', async () => {
    const s = await setup(1);
    const id = (await press.registerPress(s.signal('btn-1'))).serviceCallId!;
    await Promise.allSettled([acknowledge.execute(action(id)), complete.execute(action(id, newId()))]);
    const status = (await db.serviceCall.findFirstOrThrow()).status;
    const chain = (await db.serviceCallTransition.findMany({ orderBy: { occurredAt: 'asc' } })).map((x) => x.action);
    expect(chain).toEqual(status === 'completed' ? ['create', 'acknowledge', 'complete'] : ['create', 'acknowledge']);
    expect(['in_progress', 'completed']).toContain(status);
  });

  it('finalizar a la vez: uno OK y el otro conflicto; lectura vieja de reconocer tras finalizar también es conflicto', async () => {
    const s = await setup(1);
    const id = (await press.registerPress(s.signal('btn-1'))).serviceCallId!;
    const stale = (await calls.findById({ ...t, id }))!;
    await acknowledge.execute(action(id));
    const settled = await Promise.allSettled([complete.execute(action(id)), complete.execute(action(id, newId()))]);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.serviceCallTransition.count({ where: { action: 'complete' } })).toBe(1);
    stale.acknowledge(waiter, new Date()); // lectura anterior: pending -> in_progress
    const error = await calls.save(stale).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConcurrencyConflictError);
    expect((error as ConcurrencyConflictError).current?.status).toBe('completed');
    expect(await db.serviceCallTransition.count({ where: { action: 'acknowledge' } })).toBe(1);
  });
});
