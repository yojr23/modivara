import { newId } from '@modivara/core-contracts';
import { ValidationError } from '../errors.js';

export interface ZoneProps {
  id: string;
  organizationId: string;
  locationId: string;
  name: string;
  position: number;
  createdAt: Date;
  createdBy: string | null;
  deactivatedAt: Date | null;
}

export class Zone {
  private constructor(private readonly props: ZoneProps) {}

  static create(input: { organizationId: string; locationId: string; name: string; position?: number; createdBy: string; now: Date }): Zone {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Zone name is required');
    return new Zone({
      id: newId(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      name,
      position: input.position ?? 0,
      createdAt: input.now,
      createdBy: input.createdBy,
      deactivatedAt: null,
    });
  }

  static restore(props: ZoneProps): Zone {
    return new Zone({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get name() { return this.props.name; }
  get position() { return this.props.position; }
  get isActive() { return this.props.deactivatedAt === null; }
  update(patch: { name?: string; position?: number }): void {
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new ValidationError('Zone name is required');
      this.props.name = name;
    }
    if (patch.position !== undefined) this.props.position = patch.position;
  }

  deactivate(now: Date): void {
    if (this.isActive) this.props.deactivatedAt = now;
  }

  toProps(): ZoneProps { return { ...this.props }; }
}
