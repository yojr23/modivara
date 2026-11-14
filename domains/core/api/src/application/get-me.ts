import { MODULES, NotFoundError, PERMISSION_SOURCES, permissionsFor, type ModuleName, type Permission } from '@modivara/core-contracts';
import { SessionInvalidError } from '../domain/index.js';
import { effectiveOrganizationId, type ActorContext } from './actor.js';
import type { EntitlementRepository, LocationRepository, MembershipRepository, OrganizationRepository, UserRepository } from './ports/index.js';

export interface MeOutput {
  username: string;
  displayName: string;
  /** Negocio sobre el que opera; null solo para un superadmin que aún no eligió negocio. */
  organization: { id: string; slug: string; name: string } | null;
  modules: ModuleName[];
  locations: Array<{ id: string; name: string; timezone: string; permissions: Permission[] }>;
}

/** Lo que el portal necesita para armar la sesión (`GET /me`). La autorización real la decide cada guard. */
export class GetMe {
  constructor(
    private readonly users: UserRepository,
    private readonly organizations: OrganizationRepository,
    private readonly locations: LocationRepository,
    private readonly memberships: MembershipRepository,
    private readonly entitlements: EntitlementRepository,
  ) {}

  async execute(input: { actor: ActorContext }): Promise<MeOutput> {
    const { actor } = input;
    const user = await this.users.findById({ id: actor.actorUserId, organizationId: actor.organizationId });
    if (!user?.isActive) throw new SessionInvalidError();
    const base = { username: user.username, displayName: user.displayName };

    // Un superadmin sin negocio elegido no ve datos de ningún negocio.
    if (actor.isPlatform && !actor.actingOrganizationId) return { ...base, organization: null, modules: [], locations: [] };

    const organizationId = effectiveOrganizationId(actor);
    const org = await this.organizations.findById({ id: organizationId });
    if (!org?.isActive) throw new NotFoundError('Organization');

    const modules = await this.entitlements.listEnabledModules({ organizationId });
    const active = await this.locations.listActive({ organizationId });
    // Superadmin y dueño ven todos los locales; el resto, los de sus membresías.
    const own = actor.isPlatform || actor.isOwner ? null : await this.memberships.listActiveByUser({ organizationId, userId: actor.actorUserId });
    const locations = active.flatMap((l) => {
      const roles = own?.find((m) => m.locationId === l.id)?.roles;
      if (own && !roles) return [];
      return [{ id: l.id, name: l.name, timezone: l.timezone, permissions: [...permissionsFor(roles ?? [], actor)].filter((p) => usable(p, modules)) }];
    });
    return {
      ...base,
      organization: { id: org.id, slug: org.slug, name: org.name },
      modules,
      locations,
    };
  }
}

/**
 * Solo los permisos efectivos: los de un módulo de producto (prefijo en `MODULES`) exigen ese módulo habilitado y
 * los de `PERMISSION_SOURCES`, su fuente. `core.*` y `platform.*` no dependen de módulos. Un módulo nuevo
 * (p. ej. `pos`) queda cubierto al agregarse a `MODULES`. Es información de navegación: los guards no cambian.
 */
function usable(permission: Permission, modules: readonly ModuleName[]): boolean {
  const prefix = permission.split('.')[0] as ModuleName;
  const source = PERMISSION_SOURCES[permission];
  return (!MODULES.includes(prefix) || modules.includes(prefix)) && (!source || modules.includes(source));
}
