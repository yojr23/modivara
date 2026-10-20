import { LOCATION_ROLES, type LocationRole } from '@modivara/core-contracts';
import { InvalidValueError } from './errors.js';
import type { AppUser } from './app-user.js';
import type { Location } from './location.js';

export interface LocationMembershipProps {
  id: string;
  organizationId: string;
  userId: string;
  locationId: string;
  roles: LocationRole[];
  deactivatedAt: Date | null;
}

function normalizeRoles(roles: readonly string[]): LocationRole[] {
  if (roles.length === 0) throw new InvalidValueError('A membership needs at least one role');
  for (const r of roles) {
    if (!(LOCATION_ROLES as readonly string[]).includes(r)) throw new InvalidValueError(`Unknown role: ${r}`);
  }
  return [...new Set(roles)] as LocationRole[];
}

export class LocationMembership {
  private constructor(private props: LocationMembershipProps) {}

  /** Recibe usuario y local para garantizar que son del mismo negocio (en BD lo garantizan las FK compuestas). */
  static create(input: { id: string; user: AppUser; location: Location; roles: readonly string[] }): LocationMembership {
    if (input.user.organizationId !== input.location.organizationId) {
      throw new InvalidValueError('User and location belong to different organizations');
    }
    return new LocationMembership({
      id: input.id,
      organizationId: input.user.organizationId,
      userId: input.user.id,
      locationId: input.location.id,
      roles: normalizeRoles(input.roles),
      deactivatedAt: null,
    });
  }

  static restore(props: LocationMembershipProps): LocationMembership {
    return new LocationMembership({ ...props, roles: [...props.roles] });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get userId() { return this.props.userId; }
  get locationId() { return this.props.locationId; }
  get roles(): readonly LocationRole[] { return this.props.roles; }
  get deactivatedAt() { return this.props.deactivatedAt; }
  get isActive() { return this.props.deactivatedAt === null; }

  setRoles(roles: readonly string[]): void {
    this.props.roles = normalizeRoles(roles);
  }

  deactivate(now: Date): void {
    this.props.deactivatedAt ??= now;
  }
}
