import type { CoreAccessPort } from '@modivara/core-contracts';
import { Device } from '../domain/devices/device.js';
import { DeviceAssignment } from '../domain/devices/device-assignment.js';
import { DeviceAlreadyAssignedError, DuplicateError, NotFoundError } from '../domain/errors.js';
import type { DeviceAssignmentRepository, DeviceEventRepository, DeviceRepository, DiningTableRepository, UnknownDeviceCode } from './ports/index.js';
import { type ActorContext, requireActiveLocation, owned, scopeOf, type TenantContext } from './support.js';

export class RegisterDevice {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly devices: DeviceRepository,
  ) {}

  async execute(input: ActorContext & { code: string; model?: string | null }): Promise<Device> {
    await requireActiveLocation(this.core, input);
    const device = Device.create({ ...input, createdBy: input.actorUserId, now: new Date() });
    if (await this.devices.findActiveByCode({ ...scopeOf(input), code: device.code })) throw new DuplicateError('device');
    await this.devices.save(device);
    return device;
  }
}

export class AssignDevice {
  constructor(
    private readonly devices: DeviceRepository,
    private readonly tables: DiningTableRepository,
    private readonly assignments: DeviceAssignmentRepository,
  ) {}

  async execute(input: ActorContext & { deviceId: string; tableId: string }): Promise<DeviceAssignment> {
    const device = owned(await this.devices.findById({ ...scopeOf(input), id: input.deviceId }), input, 'device');
    if (!device.isActive) throw new NotFoundError('device');
    const table = owned(await this.tables.findById({ ...scopeOf(input), id: input.tableId }), input, 'table');
    if (!table.isActive) throw new NotFoundError('table');
    // Botón y mesa deben ser del mismo local; el tenant de la asignación sale de las entidades, no del input.
    if (device.locationId !== table.locationId || device.organizationId !== table.organizationId) throw new NotFoundError('table');
    // Un botón en una sola mesa a la vez; una mesa puede tener varios botones.
    // OPEN: ¿asignar un botón ya asignado debe moverlo en un paso? Por ahora se rechaza y hay que desasignarlo primero.
    const current = await this.assignments.findActiveByDevice({ ...scopeOf(input), deviceId: device.id });
    if (current) throw new DeviceAlreadyAssignedError(current.tableId);
    const assignment = DeviceAssignment.create({
      organizationId: device.organizationId,
      locationId: device.locationId,
      deviceId: device.id,
      tableId: table.id,
      assignedBy: input.actorUserId,
      now: new Date(),
    });
    await this.assignments.save(assignment);
    return assignment;
  }
}

export class UnassignDevice {
  constructor(
    private readonly assignments: DeviceAssignmentRepository,
  ) {}

  async execute(input: ActorContext & { deviceId: string }): Promise<DeviceAssignment> {
    const assignment = owned(await this.assignments.findActiveByDevice({ ...scopeOf(input), deviceId: input.deviceId }), input, 'device assignment');
    assignment.unassign(input.actorUserId, new Date());
    await this.assignments.save(assignment);
    return assignment;
  }
}

export type UnknownDevice = UnknownDeviceCode;

/** Códigos detectados que aún no están registrados: la consola del superadmin los vincula. */
export class ListUnknownDevices {
  constructor(
    private readonly events: DeviceEventRepository,
    private readonly core: CoreAccessPort,
  ) {}

  // OPEN: ventana por defecto de `since` (¿7 días?, ¿hasta cuándo se conservan las señales?): la decide presentación.
  async execute(input: TenantContext & { since: Date }): Promise<UnknownDevice[]> {
    await requireActiveLocation(this.core, input);
    const codes = await this.events.listUnknownCodes({ ...scopeOf(input), since: input.since });
    return codes.sort((a, b) => b.lastReceivedAt.getTime() - a.lastReceivedAt.getTime());
  }
}

export interface DeviceView {
  device: Device;
  tableId: string | null;
}

/** Botones activos del local con la mesa a la que están asignados (consola de plataforma). */
export class ListDevices {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly devices: DeviceRepository,
    private readonly assignments: DeviceAssignmentRepository,
  ) {}

  async execute(input: TenantContext): Promise<DeviceView[]> {
    await requireActiveLocation(this.core, input);
    const tableByDevice = new Map((await this.assignments.listActiveByLocation(scopeOf(input))).map((a) => [a.deviceId, a.tableId]));
    return (await this.devices.listActiveByLocation(scopeOf(input))).map((device) => ({ device, tableId: tableByDevice.get(device.id) ?? null }));
  }
}
