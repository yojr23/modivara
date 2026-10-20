import type { CoreAccessPort } from '@modivara/core-contracts';
import { Device } from '../domain/devices/device.js';
import { DeviceAssignment } from '../domain/devices/device-assignment.js';
import { DeviceAlreadyAssignedError, DuplicateError, NotFoundError } from '../domain/errors.js';
import type { DeviceAssignmentRepository, DeviceEventRepository, DeviceRepository, DiningTableRepository } from './ports/index.js';
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
    private readonly core: CoreAccessPort,
  ) {}

  async execute(input: TenantContext): Promise<UnknownDevice[]> {
    await requireActiveLocation(this.core, input);
    const byCode = new Map<string, UnknownDevice>();
    for (const event of await this.events.listUnknown(scopeOf(input))) {
      const seen = byCode.get(event.deviceCode);
      if (!seen) byCode.set(event.deviceCode, { deviceCode: event.deviceCode, pressCount: 1, lastReceivedAt: event.receivedAt });
      else {
        seen.pressCount += 1;
        if (event.receivedAt > seen.lastReceivedAt) seen.lastReceivedAt = event.receivedAt;
      }
    }
    const result: UnknownDevice[] = [];
    for (const unknown of byCode.values()) {
      if (!(await this.devices.findActiveByCode({ ...scopeOf(input), code: unknown.deviceCode }))) result.push(unknown);
    }
    return result.sort((a, b) => b.lastReceivedAt.getTime() - a.lastReceivedAt.getTime());
  }
}
