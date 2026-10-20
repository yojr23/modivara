import { randomUUID } from 'node:crypto';
import { ValidationError } from '../errors.js';

export interface DiningTableProps {
  id: string;
  organizationId: string;
  locationId: string;
  zoneId: string | null;
  label: string;
  position: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  deactivatedAt: Date | null;
}

function cleanLabel(label: string): string {
  const clean = label.trim();
  if (!clean) throw new ValidationError('Table label is required');
  return clean;
}

export class DiningTable {
  private constructor(private readonly props: DiningTableProps) {}

  static create(input: { organizationId: string; locationId: string; zoneId?: string | null; label: string; position?: number; createdBy: string; now: Date }): DiningTable {
    return new DiningTable({
      id: randomUUID(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      zoneId: input.zoneId ?? null,
      label: cleanLabel(input.label),
      position: input.position ?? 0,
      createdAt: input.now,
      createdBy: input.createdBy,
      updatedAt: input.now,
      updatedBy: input.createdBy,
      deactivatedAt: null,
    });
  }

  static restore(props: DiningTableProps): DiningTable {
    return new DiningTable({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get zoneId() { return this.props.zoneId; }
  get label() { return this.props.label; }
  get position() { return this.props.position; }
  get isActive() { return this.props.deactivatedAt === null; }

  /** "Zona · Mesa", o solo la mesa si no tiene zona. */
  displayName(zoneName: string | null): string {
    return zoneName ? `${zoneName} · ${this.label}` : this.label;
  }

  rename(label: string, by: string, now: Date): void {
    this.props.label = cleanLabel(label);
    this.props.updatedAt = now;
    this.props.updatedBy = by;
  }

  deactivate(by: string, now: Date): void {
    if (!this.isActive) return;
    this.props.deactivatedAt = now;
    this.props.updatedAt = now;
    this.props.updatedBy = by;
  }

  toProps(): DiningTableProps { return { ...this.props }; }
}
