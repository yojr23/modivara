import { randomUUID } from 'node:crypto';
import { InvalidStateError } from '../errors.js';

export interface DeviceAssignmentProps {
  id: string;
  organizationId: string;
  locationId: string;
  deviceId: string;
  tableId: string;
  assignedAt: Date;
  assignedBy: string;
  unassignedAt: Date | null;
  unassignedBy: string | null;
}

/** Fila de historial: nunca se borra, solo se cierra con `unassign`. */
export class DeviceAssignment {
  private constructor(private readonly props: DeviceAssignmentProps) {}

  static create(input: { organizationId: string; locationId: string; deviceId: string; tableId: string; assignedBy: string; now: Date }): DeviceAssignment {
    return new DeviceAssignment({
      id: randomUUID(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      deviceId: input.deviceId,
      tableId: input.tableId,
      assignedAt: input.now,
      assignedBy: input.assignedBy,
      unassignedAt: null,
      unassignedBy: null,
    });
  }

  static restore(props: DeviceAssignmentProps): DeviceAssignment {
    return new DeviceAssignment({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get deviceId() { return this.props.deviceId; }
  get tableId() { return this.props.tableId; }
  get assignedAt() { return this.props.assignedAt; }
  get unassignedAt() { return this.props.unassignedAt; }
  get isActive() { return this.props.unassignedAt === null; }

  unassign(by: string, now: Date): void {
    if (!this.isActive) throw new InvalidStateError('Assignment is already closed');
    this.props.unassignedAt = now;
    this.props.unassignedBy = by;
  }

  toProps(): DeviceAssignmentProps { return { ...this.props }; }
}
