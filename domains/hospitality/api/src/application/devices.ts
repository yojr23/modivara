import type { CoreAccessPort } from '@modivara/core-contracts';
import { Device } from '../domain/devices/device.js';
import { DeviceAssignment } from '../domain/devices/device-assignment.js';
import { DeviceAlreadyAssignedError, DuplicateError, NotFoundError } from '../domain/errors.js';
import type { Clock, DeviceAssignmentRepository, DeviceEventRepository, DeviceRepository, DiningTableRepository } from './ports/index.js';
import { type ActorContext, assertLocation, type TenantContext } from './support.js';

export class RegisterDevice {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly devices: DeviceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ActorContext & { code: string; model?: string | null }): Promise<Device> {
    await assertLocation(this.core, input);
    const device = Device.create({ ...input, createdBy: input.actorId, now: this.clock.now() });
    if (await this.devices.findActiveByCode(input.locationId, device.code)) throw new DuplicateError('device');
    await this.devices.save(device);
    return device;
  }
}

export class AssignDevice {
  constructor(
    private readonly devices: DeviceRepository,
    private readonly tables: DiningTableRepository,
    private readonly assignments: DeviceAssignmentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ActorContext & { deviceId: string; tableId: string }): Promise<DeviceAssignment> {
    const device = await this.devices.findById(input.deviceId, input.locationId);
    if (!device?.isActive) throw new NotFoundError('device');
    const table = await this.tables.findById(input.tableId, input.locationId);
    if (!table?.isActive) throw new NotFoundError('table');
    // Un botón en una sola mesa a la vez; una mesa puede tener varios botones.
    // OPEN: ¿asignar un botón ya asignado debe moverlo en un paso? Por ahora se rechaza y hay que desasignarlo primero.
    const current = await this.assignments.findActiveByDevice(device.id);
    if (current) throw new DeviceAlreadyAssignedError(current.tableId);
    const assignment = DeviceAssignment.create({ ...input, assignedBy: input.actorId, now: this.clock.now() });
    await this.assignments.save(assignment);
    return assignment;
  }
}

export class UnassignDevice {
  constructor(
    private readonly assignments: DeviceAssignmentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ActorContext & { deviceId: string }): Promise<DeviceAssignment> {
    const assignment = await this.assignments.findActiveByDevice(input.deviceId);
    if (!assignment || assignment.locationId !== input.locationId) throw new NotFoundError('device assignment');
    assignment.unassign(input.actorId, this.clock.now());
    await this.assignments.save(assignment);
    return assignment;
  }
}

export interface UnknownDevice {
  deviceCode: string;
  pressCount: number;
  lastReceivedAt: Date;
}

/** Códigos detectados que aún no están registrados: la consola del superadmin los vincula. */
export class ListUnknownDevices {
  constructor(
    private readonly events: DeviceEventRepository,
    private readonly devices: DeviceRepository,
  ) {}

  async execute(input: TenantContext): Promise<UnknownDevice[]> {
    const byCode = new Map<string, UnknownDevice>();
    for (const event of await this.events.listUnknown(input.locationId)) {
      const seen = byCode.get(event.deviceCode);
      if (!seen) byCode.set(event.deviceCode, { deviceCode: event.deviceCode, pressCount: 1, lastReceivedAt: event.receivedAt });
      else {
        seen.pressCount += 1;
        if (event.receivedAt > seen.lastReceivedAt) seen.lastReceivedAt = event.receivedAt;
      }
    }
    const result: UnknownDevice[] = [];
    for (const unknown of byCode.values()) {
      if (!(await this.devices.findActiveByCode(input.locationId, unknown.deviceCode))) result.push(unknown);
    }
    return result.sort((a, b) => b.lastReceivedAt.getTime() - a.lastReceivedAt.getTime());
  }
}
