import type { ModuleName } from '@modivara/core-contracts';
import type { AppUser, Entitlement, Location, LocationMembership, Organization, Session } from '../../domain/index.js';

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  save(organization: Organization): Promise<void>;
}

export interface LocationRepository {
  findById(id: string): Promise<Location | null>;
  save(location: Location): Promise<void>;
}

export interface UserRepository {
  findById(id: string): Promise<AppUser | null>;
  /** Solo usuarios activos: el username es único entre activos (DATA-001). */
  findActiveByUsername(organizationId: string, username: string): Promise<AppUser | null>;
  save(user: AppUser): Promise<void>;
}

export interface MembershipRepository {
  /** Solo membresías activas. */
  findActive(userId: string, locationId: string): Promise<LocationMembership | null>;
  listActiveByUser(userId: string): Promise<LocationMembership[]>;
  save(membership: LocationMembership): Promise<void>;
}

export interface SessionRepository {
  findById(id: string): Promise<Session | null>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  /** Revoca todas las sesiones vigentes del usuario (`revoked_at = now`). */
  revokeAllForUser(userId: string, now: Date): Promise<void>;
}

export interface EntitlementRepository {
  listEnabledModules(organizationId: string): Promise<ModuleName[]>;
  find(organizationId: string, module: ModuleName): Promise<Entitlement | null>;
  save(entitlement: Entitlement): Promise<void>;
}
