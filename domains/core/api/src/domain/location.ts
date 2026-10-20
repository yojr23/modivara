import { InvalidValueError } from './errors.js';

export const DEFAULT_TIMEZONE = 'America/Bogota';

const supported = new Set(Intl.supportedValuesOf('timeZone'));

export interface LocationProps {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  deactivatedAt: Date | null;
}

export class Location {
  private constructor(private props: LocationProps) {}

  static create(input: { id: string; organizationId: string; name: string; timezone?: string }): Location {
    const timezone = input.timezone ?? DEFAULT_TIMEZONE;
    // Solo se aceptan las zonas que lista el motor (DATA-001 §2); "UTC" puede no figurar ahí.
    if (!supported.has(timezone)) throw new InvalidValueError(`Unknown timezone: ${timezone}`);
    const name = input.name.trim();
    if (!name) throw new InvalidValueError('Location name is required');
    return new Location({ id: input.id, organizationId: input.organizationId, name, timezone, deactivatedAt: null });
  }

  static restore(props: LocationProps): Location {
    return new Location({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get name() { return this.props.name; }
  get timezone() { return this.props.timezone; }
  get deactivatedAt() { return this.props.deactivatedAt; }
  get isActive() { return this.props.deactivatedAt === null; }

  deactivate(now: Date): void {
    this.props.deactivatedAt ??= now;
  }
}
