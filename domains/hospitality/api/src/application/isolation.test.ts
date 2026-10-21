import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationUnavailableError, NotFoundError } from '../domain/errors.js';
import { buildWorld, seedTableWithButton, type World } from '../testing/world.js';

let w: World;
let callId: string;
let tableId: string;
let deviceId: string;
let gatewayId: string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  w = buildWorld();
  const seeded = await seedTableWithButton(w, { zone: 'Terraza' });
  tableId = seeded.table.id;
  deviceId = seeded.device.id;
  callId = (await w.registerPress.registerPress(w.press())).serviceCallId!;
  gatewayId = (await w.createGateway.execute({ ...w.ctx, name: 'GW' })).gateway.id;
});
afterEach(() => vi.useRealTimers());

/** Actores que no deben ver nada del negocio/local sembrado. */
function intruders() {
  const otherOrg = crypto.randomUUID();
  const sameLocationOtherOrg = { ...w.ctx, organizationId: otherOrg, actorUserId: crypto.randomUUID() };
  const otherLocation = { ...w.ctx, locationId: crypto.randomUUID(), actorUserId: crypto.randomUUID() };
  w.core.add({ id: otherLocation.locationId, organizationId: w.ctx.organizationId, timezone: 'UTC', active: true });
  const otherOrgOtherLocation = { organizationId: otherOrg, locationId: crypto.randomUUID(), actorUserId: crypto.randomUUID() };
  w.core.add({ id: otherOrgOtherLocation.locationId, organizationId: otherOrg, timezone: 'UTC', active: true });
  return { sameLocationOtherOrg, otherLocation, otherOrgOtherLocation };
}

describe('aislamiento por negocio y local', () => {
  it('Acknowledge/Complete: llamado ajeno -> NotFound', async () => {
    for (const actor of Object.values(intruders())) {
      await expect(w.acknowledge.execute({ ...actor, callId })).rejects.toBeInstanceOf(NotFoundError);
      await expect(w.complete.execute({ ...actor, callId })).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(w.calls.all()[0]!.status).toBe('pending');
  });

  it('AssignDevice/UnassignDevice: botón o mesa ajenos -> NotFound', async () => {
    const t2 = await w.createTable.execute({ ...w.ctx, label: '2' });
    for (const actor of Object.values(intruders())) {
      await expect(w.assignDevice.execute({ ...actor, deviceId, tableId: t2.id })).rejects.toBeInstanceOf(NotFoundError);
      await expect(w.unassignDevice.execute({ ...actor, deviceId })).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(w.assignments.history().every((a) => a.tableId === tableId)).toBe(true);
  });

  it('AssignDevice: el tenant de la asignación sale de las entidades cargadas', async () => {
    const t2 = await w.createTable.execute({ ...w.ctx, label: '2' });
    const d2 = await w.registerDevice.execute({ ...w.ctx, code: 'B2' });
    const a = await w.assignDevice.execute({ ...w.ctx, deviceId: d2.id, tableId: t2.id });
    expect(a).toMatchObject({ organizationId: d2.organizationId, locationId: d2.locationId });
  });

  it('Rename/Deactivate/CreateTable/CreateZone/RegisterDevice/CreateGateway: otro negocio -> local no disponible; otro local -> NotFound', async () => {
    const { sameLocationOtherOrg, otherLocation } = intruders();
    await expect(w.updateTable.execute({ ...sameLocationOtherOrg, tableId, label: 'x' })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.deactivateTable.execute({ ...sameLocationOtherOrg, tableId })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.createZone.execute({ ...sameLocationOtherOrg, name: 'Z' })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.createTable.execute({ ...sameLocationOtherOrg, label: '9' })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.registerDevice.execute({ ...sameLocationOtherOrg, code: 'Z' })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.createGateway.execute({ ...sameLocationOtherOrg, name: 'Z' })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.updateTable.execute({ ...otherLocation, tableId, label: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.deactivateTable.execute({ ...otherLocation, tableId })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('CreateTable no acepta una zona de otro local', async () => {
    const zone = await w.createZone.execute({ ...w.ctx, name: 'Salón' });
    const { otherLocation } = intruders();
    await expect(w.createTable.execute({ ...otherLocation, label: '1', zoneId: zone.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('RecordHeartbeat: gateway ajeno -> NotFound', async () => {
    for (const actor of Object.values(intruders())) {
      await expect(w.heartbeat.execute({ ...actor, gatewayId })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('listados: valida el local con Core antes de consultar', async () => {
    const { sameLocationOtherOrg } = intruders();
    const permissions = new Set(['hospitality.calls.read'] as const);
    await expect(w.listActive.execute({ ...sameLocationOtherOrg, permissions })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.listUnknown.execute({ ...sameLocationOtherOrg, since: new Date(0) })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.connectivity.execute(sameLocationOtherOrg)).rejects.toBeInstanceOf(LocationUnavailableError);
  });

  it('pulsación de otro negocio con el mismo local y código -> unknown_device', async () => {
    const out = await w.registerPress.registerPress(w.press({ organizationId: crypto.randomUUID() }));
    expect(out.result).toBe('unknown_device');
    expect(w.calls.all()).toHaveLength(1);
  });

  it('los repositorios acotan por negocio y local, no solo por local', async () => {
    const other = { organizationId: crypto.randomUUID(), locationId: w.ctx.locationId };
    expect(await w.calls.findById({ ...other, id: callId })).toBeNull();
    expect(await w.calls.findActive({ ...other, tableId, callType: 'attention' })).toBeNull();
    expect(await w.calls.listActive(other)).toEqual([]);
    expect(await w.devices.findById({ ...other, id: deviceId })).toBeNull();
    expect(await w.assignments.findActiveByDevice({ ...other, deviceId })).toBeNull();
    expect(await w.assignments.listActiveByTable({ ...other, tableId })).toEqual([]);
    expect(await w.gateways.findById({ ...other, id: gatewayId })).toBeNull();
    expect(w.events.lastPress({ ...other, deviceId, buttonKey: null })).toBeNull();
    expect(await w.calls.findActive({ ...w.ctx, tableId, callType: 'attention' })).not.toBeNull();
  });
});
