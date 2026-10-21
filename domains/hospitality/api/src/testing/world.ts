import { AcknowledgeCall } from '../application/acknowledge-call.js';
import { CompleteCall } from '../application/complete-call.js';
import { AssignDevice, ListDevices, ListUnknownDevices, RegisterDevice, UnassignDevice } from '../application/devices.js';
import { CreateGateway, GetConnectivity, GetDeviceStatus, RecordHeartbeat } from '../application/gateways.js';
import { ListActiveCalls } from '../application/list-active-calls.js';
import type { NormalizedPress } from '../application/ports/index.js';
import { RegisterButtonPress } from '../application/register-button-press.js';
import { CreateTable, CreateZone, DeactivateTable, DeactivateZone, ListTables, ListZones, UpdateTable, UpdateZone } from '../application/zones-and-tables.js';
import {
  FakeCoreAccess,
  InMemoryButtonPressStore,
  InMemoryDeviceAssignmentRepository,
  InMemoryDeviceEventRepository,
  InMemoryDeviceRepository,
  InMemoryDiningTableRepository,
  InMemoryGatewayRepository,
  InMemoryLocationSettingsRepository,
  InMemoryServiceCallRepository,
  InMemoryZoneRepository,
  RecordingNotifications,
} from './in-memory.js';

/** Todo el dominio cableado con dobles en memoria, para las pruebas de aplicación. */
export function buildWorld() {
  const organizationId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  const core = new FakeCoreAccess();
  core.add({ id: locationId, organizationId, timezone: 'America/Bogota', active: true });

  const calls = new InMemoryServiceCallRepository();
  const zones = new InMemoryZoneRepository();
  const tables = new InMemoryDiningTableRepository();
  const devices = new InMemoryDeviceRepository();
  const assignments = new InMemoryDeviceAssignmentRepository();
  const gateways = new InMemoryGatewayRepository();
  const settings = new InMemoryLocationSettingsRepository();
  const events = new InMemoryDeviceEventRepository(devices);
  const store = new InMemoryButtonPressStore(calls, events);
  const notifications = new RecordingNotifications((id) => calls.all().some((c) => c.id === id));

  const connectivity = new GetConnectivity(core, gateways);
  const ctx = { organizationId, locationId, actorUserId };
  const press = (over: Partial<NormalizedPress> = {}): NormalizedPress => ({
    gatewayId: crypto.randomUUID(),
    organizationId,
    locationId,
    deviceCode: 'BTN-1',
    buttonKey: null,
    callType: 'attention',
    sentAt: null,
    transport: 'http',
    payload: { device_code: 'BTN-1' },
    ...over,
  });

  return {
    ctx, press, core, settings, calls, zones, tables, devices, assignments, gateways, events, store, notifications,
    registerPress: new RegisterButtonPress(core, devices, assignments, tables, zones, store, notifications),
    acknowledge: new AcknowledgeCall(calls, notifications),
    complete: new CompleteCall(calls, notifications),
    createZone: new CreateZone(core, zones),
    createTable: new CreateTable(core, zones, tables),
    updateTable: new UpdateTable(core, zones, tables),
    listZones: new ListZones(core, zones),
    updateZone: new UpdateZone(core, zones),
    deactivateZone: new DeactivateZone(core, zones, tables),
    listTables: new ListTables(core, zones, tables),
    listDevices: new ListDevices(core, devices, assignments),
    deviceStatus: new GetDeviceStatus(core, tables, assignments, connectivity),
    deactivateTable: new DeactivateTable(core, tables, assignments),
    registerDevice: new RegisterDevice(core, devices),
    assignDevice: new AssignDevice(devices, tables, assignments),
    unassignDevice: new UnassignDevice(assignments),
    createGateway: new CreateGateway(core, gateways),
    heartbeat: new RecordHeartbeat(gateways),
    connectivity,
    listActive: new ListActiveCalls(core, calls, tables, zones, settings),
    listUnknown: new ListUnknownDevices(events, core),
  };
}

export type World = ReturnType<typeof buildWorld>;

/** Mesa con un botón asignado, lista para recibir pulsaciones. */
export async function seedTableWithButton(w: World, opts: { zone?: string; label?: string; code?: string } = {}) {
  const zone = opts.zone ? await w.createZone.execute({ ...w.ctx, name: opts.zone }) : null;
  const table = await w.createTable.execute({ ...w.ctx, label: opts.label ?? '5', zoneId: zone?.id });
  const device = await w.registerDevice.execute({ ...w.ctx, code: opts.code ?? 'BTN-1' });
  await w.assignDevice.execute({ ...w.ctx, deviceId: device.id, tableId: table.id });
  return { zone, table, device };
}
