import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { RegisterButtonPress } from '../../application/register-button-press.js';
import type { NormalizedPress } from '../../application/ports/index.js';
import { Device } from '../../domain/devices/device.js';
import { DeviceAssignment } from '../../domain/devices/device-assignment.js';
import { DeviceEvent } from '../../domain/devices/device-event.js';
import { Gateway } from '../../domain/devices/gateway.js';
import { ConcurrencyConflictError } from '../../domain/errors.js';
import { ServiceCall } from '../../domain/service-calls/service-call.js';
import { DiningTable } from '../../domain/tables/dining-table.js';
import { FakeCoreAccess, RecordingNotifications } from '../../testing/in-memory.js';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { PrismaButtonPressStore } from './prisma-button-press-store.js';
import { PrismaDeviceAssignmentRepository } from './prisma-device-assignment-repository.js';
import { PrismaDeviceEventRepository } from './prisma-device-event-repository.js';
import { PrismaDeviceRepository } from './prisma-device-repository.js';
import { PrismaDiningTableRepository } from './prisma-dining-table-repository.js';
import { PrismaGatewayRepository } from './prisma-gateway-repository.js';
import { PrismaServiceCallRepository } from './prisma-service-call-repository.js';
import { PrismaZoneRepository } from './prisma-zone-repository.js';

const db = hospitalityPrismaForTests();
const t = tenant();
const waiter = newId();
const core = new FakeCoreAccess();
core.add({ id: t.locationId, organizationId: t.organizationId, timezone: 'America/Bogota', active: true });
const calls = new PrismaServiceCallRepository(db);
const store = new PrismaButtonPressStore(db);
const press = new RegisterButtonPress(
  core, new PrismaDeviceRepository(db), new PrismaDeviceAssignmentRepository(db), new PrismaDiningTableRepository(db),
  new PrismaZoneRepository(db), store, new RecordingNotifications(),
);

beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

/** Gateway + mesa + `n` botones asignados a ella. */
async function setup(buttons = 1) {
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
  const normalized = (deviceCode: string): NormalizedPress => ({
    ...t, gatewayId: gateway.id, deviceCode, buttonKey: null, callType: 'attention', sentAt: null, transport: 'http', payload: { code: deviceCode },
  });
  return { gateway, table, codes, normalized };
}

const counts = async () => ({
  calls: await db.serviceCall.count(),
  transitions: await db.serviceCallTransition.count(),
  outbox: await db.outboxEvent.count(),
  events: await db.deviceEvent.count(),
});

describe('pulsaciones (ButtonPressStore + RegisterButtonPress)', () => {
  it('dos botones de la misma mesa pulsados a la vez: un solo llamado con press_count 2', async () => {
    const s = await setup(2);
    const outcomes = await Promise.all(s.codes.map((c) => press.registerPress(s.normalized(c))));
    expect(outcomes.map((o) => o.result).sort()).toEqual(['call_created', 'repeat_press']);
    const rows = await db.serviceCall.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pressCount).toBe(2);
    expect(new Set(outcomes.map((o) => o.serviceCallId))).toEqual(new Set([rows[0]!.id]));
    // Solo la creación genera transición y outbox; los dos eventos del botón quedan registrados.
    expect(await counts()).toEqual({ calls: 1, transitions: 1, outbox: 1, events: 2 });
    expect(await db.outboxEvent.findFirstOrThrow()).toMatchObject({ eventType: 'hospitality.service_call.created', aggregateId: rows[0]!.id });
  });

  it('el mismo botón pulsado a la vez: se serializa y la segunda señal se descarta (debounce)', async () => {
    const s = await setup(1);
    const outcomes = await Promise.all([press.registerPress(s.normalized('btn-1')), press.registerPress(s.normalized('btn-1'))]);
    expect(outcomes.map((o) => o.result).sort()).toEqual(['call_created', 'debounced']);
    expect((await db.serviceCall.findFirstOrThrow()).pressCount).toBe(1);
  });

  it('muchas pulsaciones concurrentes de botones distintos no pierden ninguna cuenta', async () => {
    const s = await setup(6);
    await Promise.all(s.codes.map((c) => press.registerPress(s.normalized(c))));
    expect((await db.serviceCall.findFirstOrThrow()).pressCount).toBe(6);
    expect(await counts()).toMatchObject({ calls: 1, transitions: 1, outbox: 1, events: 6 });
  });

  it('señales sin dispositivo operable se registran sin llamado', async () => {
    const s = await setup(1);
    expect((await press.registerPress(s.normalized('desconocido'))).result).toBe('unknown_device');
    expect(await counts()).toEqual({ calls: 0, transitions: 0, outbox: 0, events: 1 });
    const unknown = await new PrismaDeviceEventRepository(db).listUnknownCodes({ ...t, since: new Date(Date.now() - 60_000) });
    expect(unknown).toMatchObject([{ deviceCode: 'desconocido', pressCount: 1 }]);
  });

  it('rollback completo si falla una parte: ni llamado, ni transición, ni outbox, ni evento', async () => {
    const s = await setup(1);
    const device = (await new PrismaDeviceRepository(db).findActiveByCode({ ...t, code: 'btn-1' }))!;
    const candidate = ServiceCall.create({
      ...t, table: { id: s.table.id, label: '5', zoneId: null, zoneName: null }, callType: 'attention', deviceEventId: newId(), correlationId: newId(), now: new Date(),
    });
    // gateway inexistente: la FK compuesta rechaza el device_event al final de la transacción
    const bad = DeviceEvent.create({
      ...t, gatewayId: newId(), deviceId: device.id, deviceCode: 'btn-1', buttonKey: null, transport: 'http', payload: {}, sentAt: null,
      receivedAt: new Date(), result: 'call_created', serviceCallId: candidate.id, correlationId: newId(),
    });
    await expect(
      store.withDeviceLock(device.id, async (tx) => {
        await tx.upsertActiveCall(candidate, new Date());
        await tx.saveDeviceEvent(bad);
      }),
    ).rejects.toThrow();
    expect(await counts()).toEqual({ calls: 0, transitions: 0, outbox: 0, events: 0 });
    await expect(store.withDeviceLock(device.id, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('PrismaServiceCallRepository', () => {
  const created = async (s: Awaited<ReturnType<typeof setup>>) => {
    const out = await press.registerPress(s.normalized('btn-1'));
    return out.serviceCallId!;
  };

  it('reconocer y finalizar persisten estado, transición y outbox en una transacción; findById/listActive acotados', async () => {
    const s = await setup(1);
    const id = await created(s);
    expect(await calls.listActive(t)).toHaveLength(1);
    expect(await calls.findById({ ...tenant(), id })).toBeNull();
    const call = (await calls.findById({ ...t, id }))!;
    call.acknowledge(waiter, new Date());
    await calls.save(call);
    const again = (await calls.findById({ ...t, id }))!;
    expect(again.status).toBe('in_progress');
    again.complete(waiter, new Date());
    await calls.save(again);
    expect(await calls.listActive(t)).toHaveLength(0);
    const transitions = await db.serviceCallTransition.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(transitions.map((x) => x.action)).toEqual(['create', 'acknowledge', 'complete']);
    expect(transitions[1]).toMatchObject({ actorUserId: waiter, fromStatus: 'pending', toStatus: 'in_progress' });
    expect((await db.outboxEvent.findMany()).map((e) => e.eventType).sort()).toEqual([
      'hospitality.service_call.acknowledged', 'hospitality.service_call.completed', 'hospitality.service_call.created',
    ]);
  });

  it('dos usuarios reconociendo a la vez: uno gana, el otro recibe ConcurrencyConflictError con el estado actual', async () => {
    const s = await setup(1);
    const id = await created(s);
    const a = (await calls.findById({ ...t, id }))!;
    const b = (await calls.findById({ ...t, id }))!;
    a.acknowledge(waiter, new Date());
    b.acknowledge(newId(), new Date());
    await calls.save(a);
    const error = await calls.save(b).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConcurrencyConflictError);
    expect((error as ConcurrencyConflictError).current?.status).toBe('in_progress');
    expect(await db.serviceCallTransition.count({ where: { action: 'acknowledge' } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: 'hospitality.service_call.acknowledged' } })).toBe(1);
  });

  it('acknowledge no pisa el press_count de pulsaciones concurrentes', async () => {
    const s = await setup(2);
    const id = await created(s);
    const stale = (await calls.findById({ ...t, id }))!;
    await press.registerPress(s.normalized('btn-2')); // sube a 2 después de la lectura
    stale.acknowledge(waiter, new Date());
    await calls.save(stale);
    expect((await calls.findById({ ...t, id }))!.pressCount).toBe(2);
  });

  it('crear un segundo llamado activo para la misma mesa y tipo es ConcurrencyConflictError', async () => {
    const s = await setup(1);
    await created(s);
    const dup = ServiceCall.create({
      ...t, table: { id: s.table.id, label: '5', zoneId: null, zoneName: null }, callType: 'attention', deviceEventId: newId(), correlationId: newId(), now: new Date(),
    });
    await expect(calls.save(dup)).rejects.toBeInstanceOf(ConcurrencyConflictError);
    expect(await counts()).toMatchObject({ calls: 1, transitions: 1, outbox: 1 });
  });
});
