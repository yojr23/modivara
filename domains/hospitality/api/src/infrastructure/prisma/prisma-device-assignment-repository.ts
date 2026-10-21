import { DeviceAssignment } from '../../domain/devices/device-assignment.js';
import { DeviceAlreadyAssignedError } from '../../domain/errors.js';
import type { DeviceAssignmentRepository, Scope } from '../../application/ports/index.js';
import type { HospitalityPrisma } from './client.js';
import { isUniqueViolation, type Db } from './db.js';

type Row = { id: string; organizationId: string; locationId: string; deviceId: string; tableId: string; assignedAt: Date; assignedBy: string; unassignedAt: Date | null; unassignedBy: string | null };
const toDomain = (r: Row) =>
  DeviceAssignment.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, deviceId: r.deviceId, tableId: r.tableId,
    assignedAt: r.assignedAt, assignedBy: r.assignedBy, unassignedAt: r.unassignedAt, unassignedBy: r.unassignedBy,
  });

const write = (db: Db, a: DeviceAssignment) => {
  const p = a.toProps();
  return db.deviceAssignment.upsert({
    where: { id: p.id },
    create: { ...p },
    // Solo el cierre cambia: la asignación es historial.
    update: { unassignedAt: p.unassignedAt, unassignedBy: p.unassignedBy },
  });
};

export class PrismaDeviceAssignmentRepository implements DeviceAssignmentRepository {
  /** Necesita el cliente (no solo `Db`) para abrir la transacción de `reassign`. */
  constructor(private readonly db: HospitalityPrisma) {}

  async findActiveByDevice({ deviceId, organizationId, locationId }: Scope & { deviceId: string }) {
    const r = await this.db.deviceAssignment.findFirst({ where: { organizationId, locationId, deviceId, unassignedAt: null } });
    return r && toDomain(r);
  }

  async listActiveByTable({ tableId, organizationId, locationId }: Scope & { tableId: string }) {
    const rows = await this.db.deviceAssignment.findMany({ where: { organizationId, locationId, tableId, unassignedAt: null }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }

  async listActiveByLocation({ organizationId, locationId }: Scope) {
    const rows = await this.db.deviceAssignment.findMany({ where: { organizationId, locationId, unassignedAt: null }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }

  async findAt({ deviceId, at, organizationId, locationId }: Scope & { deviceId: string; at: Date }) {
    const r = await this.db.deviceAssignment.findFirst({
      where: { organizationId, locationId, deviceId, assignedAt: { lte: at }, OR: [{ unassignedAt: null }, { unassignedAt: { gt: at } }] },
    });
    return r && toDomain(r);
  }

  async save(a: DeviceAssignment) {
    try {
      await write(this.db, a);
    } catch (e) {
      throw await this.alreadyAssigned(e, a);
    }
  }

  async reassign(closed: DeviceAssignment, opened: DeviceAssignment) {
    try {
      await this.db.$transaction(async (tx) => {
        await write(tx, closed);
        await write(tx, opened);
      });
    } catch (e) {
      throw await this.alreadyAssigned(e, opened);
    }
  }

  /** P2002 sobre `uq_device_assignments_active`: otra asignación activa del botón (carrera entre dos asignaciones). */
  private async alreadyAssigned(e: unknown, a: DeviceAssignment): Promise<unknown> {
    if (!isUniqueViolation(e)) return e;
    const current = await this.findActiveByDevice({ organizationId: a.organizationId, locationId: a.locationId, deviceId: a.deviceId });
    return new DeviceAlreadyAssignedError(current?.tableId ?? a.tableId);
  }
}
