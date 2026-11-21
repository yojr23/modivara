import { NotFoundError, permissionsFor, type LocationRef, type ModuleName, type Permission } from '@modivara/core-contracts';
import { effectivePermissions } from './effective-permissions.js';
import { isLocationAvailable } from './location-availability.js';
import { effectiveOrganizationId, type ActorContext } from './actor.js';
import type { EntitlementRepository, LocationRepository, MembershipRepository } from './ports/index.js';

export interface LocationAccess {
  location: LocationRef;
  /** Permisos efectivos: los del rol cuyo módulo y fuente están habilitados (el superadmin, todos: ADR-002 D3). */
  permissions: ReadonlySet<Permission>;
  /** Permisos que da el rol, sin mirar módulos (para distinguir `permission_denied` de `module_disabled`). */
  granted: ReadonlySet<Permission>;
  /** Módulos habilitados del negocio del local. */
  modules: ModuleName[];
}

export class ResolveLocationAccess {
  constructor(
    private readonly locations: LocationRepository,
    private readonly memberships: MembershipRepository,
    private readonly entitlements: EntitlementRepository,
  ) {}

  async execute(input: { actor: ActorContext; locationId: string }): Promise<LocationAccess> {
    const { actor } = input;
    const organizationId = effectiveOrganizationId(actor);
    // Aislamiento entre negocios: un local ajeno es indistinguible de uno inexistente.
    const found = await this.locations.findByIdWithOrganization({ id: input.locationId, organizationId });
    if (!found || !isLocationAvailable(found)) throw new NotFoundError('Location');
    const { location } = found;

    const membership = actor.isPlatform
      ? null
      : await this.memberships.findActive({ organizationId, userId: actor.actorUserId, locationId: location.id });
    const granted = permissionsFor(membership?.roles ?? [], actor);
    const modules = await this.entitlements.listEnabledModules({ organizationId: location.organizationId });
    return {
      location: { id: location.id, organizationId: location.organizationId, timezone: location.timezone, active: true },
      permissions: actor.isPlatform ? granted : effectivePermissions(granted, modules),
      granted,
      modules,
    };
  }
}
