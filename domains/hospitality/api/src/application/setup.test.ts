import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gateway } from '../domain/devices/gateway.js';
import { DeviceAlreadyAssignedError, DuplicateError, LocationUnavailableError, NotFoundError, TableInUseError } from '../domain/errors.js';
import { buildWorld, seedTableWithButton, type World } from '../testing/world.js';

let w: World;
const T0 = new Date('2026-10-19T10:00:00Z');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  w = buildWorld();
});
afterEach(() => vi.useRealTimers());

describe('zonas y mesas', () => {
  it('valida el local vía CoreAccessPort (inexistente, inactivo, de otra organización)', async () => {
    const other = { ...w.ctx, locationId: crypto.randomUUID() };
    await expect(w.createZone.execute({ ...other, name: 'Z' })).rejects.toBeInstanceOf(LocationUnavailableError);
    w.core.add({ id: other.locationId, organizationId: w.ctx.organizationId, timezone: 'UTC', active: false });
    await expect(w.createTable.execute({ ...other, label: '1' })).rejects.toBeInstanceOf(LocationUnavailableError);
    const foreign = { ...w.ctx, organizationId: crypto.randomUUID() };
    await expect(w.createZone.execute({ ...foreign, name: 'Z' })).rejects.toBeInstanceOf(LocationUnavailableError);
  });

  it('mismo número permitido en zonas distintas, no dentro de la misma ni dos sin zona', async () => {
    const a = await w.createZone.execute({ ...w.ctx, name: 'Terraza' });
    const b = await w.createZone.execute({ ...w.ctx, name: 'Salón' });
    await w.createTable.execute({ ...w.ctx, label: '1', zoneId: a.id });
    await w.createTable.execute({ ...w.ctx, label: '1', zoneId: b.id });
    await expect(w.createTable.execute({ ...w.ctx, label: ' 1 ', zoneId: a.id })).rejects.toBeInstanceOf(DuplicateError);
    await w.createTable.execute({ ...w.ctx, label: 'M1' });
    await expect(w.createTable.execute({ ...w.ctx, label: 'm1' })).rejects.toBeInstanceOf(DuplicateError);
  });

  it('zona duplicada y zona inexistente', async () => {
    await w.createZone.execute({ ...w.ctx, name: 'Terraza' });
    await expect(w.createZone.execute({ ...w.ctx, name: 'terraza' })).rejects.toBeInstanceOf(DuplicateError);
    await expect(w.createTable.execute({ ...w.ctx, label: '1', zoneId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('renombrar respeta la unicidad; desactivar libera la etiqueta', async () => {
    const t1 = await w.createTable.execute({ ...w.ctx, label: '1' });
    await w.createTable.execute({ ...w.ctx, label: '2' });
    await expect(w.renameTable.execute({ ...w.ctx, tableId: t1.id, label: '2' })).rejects.toBeInstanceOf(DuplicateError);
    expect((await w.renameTable.execute({ ...w.ctx, tableId: t1.id, label: 'Barra 1' })).label).toBe('Barra 1');
    await w.deactivateTable.execute({ ...w.ctx, tableId: t1.id });
    await w.createTable.execute({ ...w.ctx, label: 'Barra 1' });
  });

  it('no desactiva una mesa con botones asignados', async () => {
    const { table, device } = await seedTableWithButton(w);
    await expect(w.deactivateTable.execute({ ...w.ctx, tableId: table.id })).rejects.toBeInstanceOf(TableInUseError);
    await w.unassignDevice.execute({ ...w.ctx, deviceId: device.id });
    await w.deactivateTable.execute({ ...w.ctx, tableId: table.id });
  });

  it('aislamiento por local: no renombra mesas de otro local', async () => {
    const t = await w.createTable.execute({ ...w.ctx, label: '1' });
    const other = { ...w.ctx, locationId: crypto.randomUUID() };
    w.core.add({ id: other.locationId, organizationId: other.organizationId, timezone: 'UTC', active: true });
    await expect(w.renameTable.execute({ ...other, tableId: t.id, label: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('botones y asignaciones', () => {
  it('código duplicado entre activos', async () => {
    await w.registerDevice.execute({ ...w.ctx, code: 'B1' });
    await expect(w.registerDevice.execute({ ...w.ctx, code: 'B1' })).rejects.toBeInstanceOf(DuplicateError);
  });

  it('un botón en una sola mesa a la vez; una mesa con varios botones', async () => {
    const t1 = await w.createTable.execute({ ...w.ctx, label: '1' });
    const t2 = await w.createTable.execute({ ...w.ctx, label: '2' });
    const d1 = await w.registerDevice.execute({ ...w.ctx, code: 'B1' });
    const d2 = await w.registerDevice.execute({ ...w.ctx, code: 'B2' });
    await w.assignDevice.execute({ ...w.ctx, deviceId: d1.id, tableId: t1.id });
    await w.assignDevice.execute({ ...w.ctx, deviceId: d2.id, tableId: t1.id });
    await expect(w.assignDevice.execute({ ...w.ctx, deviceId: d1.id, tableId: t2.id })).rejects.toBeInstanceOf(DeviceAlreadyAssignedError);
  });

  it('desasignar conserva el historial y permite reasignar a otra mesa', async () => {
    const t1 = await w.createTable.execute({ ...w.ctx, label: '1' });
    const t2 = await w.createTable.execute({ ...w.ctx, label: '2' });
    const d = await w.registerDevice.execute({ ...w.ctx, code: 'B1' });
    await w.assignDevice.execute({ ...w.ctx, deviceId: d.id, tableId: t1.id });
    vi.setSystemTime(new Date(T0.getTime() + 60_000));
    await w.unassignDevice.execute({ ...w.ctx, deviceId: d.id });
    await w.assignDevice.execute({ ...w.ctx, deviceId: d.id, tableId: t2.id });
    const history = w.assignments.history();
    expect(history).toHaveLength(2);
    expect(history.filter((a) => a.isActive).map((a) => a.tableId)).toEqual([t2.id]);
    await expect(w.unassignDevice.execute({ ...w.ctx, deviceId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('no asigna botones ni mesas de otro local', async () => {
    const t = await w.createTable.execute({ ...w.ctx, label: '1' });
    const d = await w.registerDevice.execute({ ...w.ctx, code: 'B1' });
    const other = { ...w.ctx, locationId: crypto.randomUUID() };
    await expect(w.assignDevice.execute({ ...other, deviceId: d.id, tableId: t.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('ListUnknownDevices agrupa por código y oculta los ya registrados', async () => {
    await w.registerPress.execute(w.press({ deviceCode: 'X1' }));
    vi.setSystemTime(new Date(T0.getTime() + 5_000));
    await w.registerPress.execute(w.press({ deviceCode: 'X1' }));
    await w.registerPress.execute(w.press({ deviceCode: 'X2' }));
    const list = await w.listUnknown.execute(w.ctx);
    expect(list.map((u) => [u.deviceCode, u.pressCount]).sort()).toEqual([['X1', 2], ['X2', 1]]);
    await w.registerDevice.execute({ ...w.ctx, code: 'X1' });
    expect((await w.listUnknown.execute(w.ctx)).map((u) => u.deviceCode)).toEqual(['X2']);
    await expect(w.listUnknown.execute({ ...w.ctx, locationId: crypto.randomUUID() })).rejects.toBeInstanceOf(LocationUnavailableError);
  });
});

describe('gateways', () => {
  it('CreateGateway devuelve la clave una vez y guarda solo el hash', async () => {
    const { gateway, plainKey } = await w.createGateway.execute({ ...w.ctx, name: 'GW' });
    const stored = await w.gateways.findByKeyHash(Gateway.hashKey(plainKey));
    expect(stored?.id).toBe(gateway.id);
    expect(JSON.stringify(stored!.toProps())).not.toContain(plainKey);
  });

  it('conectividad: señal cada 30 s, desconectado pasados 90 s', async () => {
    const { gateway } = await w.createGateway.execute({ ...w.ctx, name: 'GW' });
    expect(await w.connectivity.execute(w.ctx)).toMatchObject({ anyDisconnected: true });
    await w.heartbeat.execute({ ...w.ctx, gatewayId: gateway.id });
    expect((await w.connectivity.execute(w.ctx)).anyDisconnected).toBe(false);
    vi.setSystemTime(new Date(T0.getTime() + 90_000));
    expect((await w.connectivity.execute(w.ctx)).anyDisconnected).toBe(false);
    vi.setSystemTime(new Date(T0.getTime() + 90_001));
    const status = await w.connectivity.execute(w.ctx);
    expect(status.anyDisconnected).toBe(true);
    expect(status.gateways[0]).toMatchObject({ connected: false, lastSeenAt: T0 });
    await w.heartbeat.execute({ ...w.ctx, gatewayId: gateway.id });
    expect((await w.connectivity.execute(w.ctx)).anyDisconnected).toBe(false);
  });

  it('el heartbeat de otro local no encuentra el gateway; GetConnectivity aísla por local', async () => {
    const { gateway } = await w.createGateway.execute({ ...w.ctx, name: 'GW' });
    await expect(w.heartbeat.execute({ ...w.ctx, locationId: crypto.randomUUID(), gatewayId: gateway.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.connectivity.execute({ ...w.ctx, locationId: crypto.randomUUID() })).rejects.toBeInstanceOf(LocationUnavailableError);
  });
});
