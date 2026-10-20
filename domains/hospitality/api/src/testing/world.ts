import { AcknowledgeCall } from '../application/acknowledge-call.js';
import { CompleteCall } from '../application/complete-call.js';
import { AssignDevice, ListUnknownDevices, RegisterDevice, UnassignDevice } from '../application/devices.js';
import { CreateGateway, GetConnectivity, RecordHeartbeat } from '../application/gateways.js';
import { ListActiveCalls } from '../application/list-active-calls.js';
import type { NormalizedPress } from '../application/ports/index.js';
import { RegisterButtonPress } from '../application/register-button-press.js';
import { CreateTable, CreateZone, DeactivateTable, RenameTable } from '../application/zones-and-tables.js';
import {
  FakeCoreAccess,
  InMemoryDeviceAssignmentRepository,
  InMemoryDeviceEventRepository,
  InMemoryDeviceRepository,
  InMemoryDiningTableRepository,
  InMemoryGatewayRepository,
  InMemoryServiceCallRepository,
  InMemoryZoneRepository,
  RecordingNotifications,
  testClock,
} from './in-memory.js';

/** Todo el dominio cableado con dobles en memoria, para las pruebas de aplicación. */
export function buildWorld() {
  const organizationId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const core = new FakeCoreAccess();
  core.add({ id: locationId, organizationId, timezone: 'America/Bogota', active: true });

  const calls = new InMemoryServiceCallRepository();
  const zones = new InMemoryZoneRepository();
  const tables = new InMemoryDiningTableRepository();
  const devices = new InMemoryDeviceRepository();
  const assignments = new InMemoryDeviceAssignmentRepository();
  const gateways = new InMemoryGatewayRepository();
  const events = new InMemoryDeviceEventRepository();
  const notifications = new RecordingNotifications();
  const clock = testClock;

  const ctx = { organizationId, locationId, actorId };
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
    ctx, press, core, calls, zones, tables, devices, assignments, gateways, events, notifications,
    registerPress: new RegisterButtonPress(devices, assignments, tables, zones, calls, events, notifications, clock),
    acknowledge: new AcknowledgeCall(calls, notifications, clock),
    complete: new CompleteCall(calls, notifications, clock),
    createZone: new CreateZone(core, zones, clock),
    createTable: new CreateTable(core, zones, tables, clock),
    renameTable: new RenameTable(core, tables, clock),
    deactivateTable: new DeactivateTable(core, tables, assignments, clock),
    registerDevice: new RegisterDevice(core, devices, clock),
    assignDevice: new AssignDevice(devices, tables, assignments, clock),
    unassignDevice: new UnassignDevice(assignments, clock),
    createGateway: new CreateGateway(core, gateways, clock),
    heartbeat: new RecordHeartbeat(gateways, clock),
    connectivity: new GetConnectivity(gateways, clock),
    listActive: new ListActiveCalls(calls, tables, zones),
    listUnknown: new ListUnknownDevices(events, devices),
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
