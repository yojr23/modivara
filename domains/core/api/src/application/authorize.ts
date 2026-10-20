import { permissionsFor, type ModuleName, type Permission } from '@modivara/core-contracts';
import { ModuleDisabledError, PermissionDeniedError } from '../domain/index.js';
import { ResolveLocationAccess } from './resolve-location-access.js';
import type { ActorContext } from './actor.js';
import type { EntitlementRepository, MembershipRepository } from './ports/index.js';

/** Decisiones de autorización que consumen los guards. El superadmin pasa siempre (ADR-002 D3). */
export class Authorize {
  constructor(
    private readonly access: ResolveLocationAccess,
    private readonly memberships: MembershipRepository,
    private readonly entitlements: EntitlementRepository,
  ) {}

  /**
   * Con `locationId`: el permiso debe tenerlo el actor en ese local (un local ajeno responde "no existe").
   * Sin él: en cualquiera de sus locales, o por ser dueño.
   */
  async permission(input: { actor: ActorContext; permission: Permission; locationId?: string }): Promise<void> {
    const { actor, permission } = input;
    if (actor.isPlatform) return;
    if (input.locationId) {
      const { permissions } = await this.access.execute({ actor, locationId: input.locationId });
      if (!permissions.has(permission)) throw new PermissionDeniedError(`${permission} required`);
      return;
    }
    // Un dueño es admin en todos sus locales, aunque aún no tenga membresías.
    if (actor.isOwner && permissionsFor(['admin'], actor).has(permission)) return;
    const own = await this.memberships.listActiveByUser({ organizationId: actor.organizationId, userId: actor.actorUserId });
    if (!own.some((m) => permissionsFor(m.roles, actor).has(permission))) throw new PermissionDeniedError(`${permission} required`);
  }

  async module(input: { actor: ActorContext; module: ModuleName }): Promise<void> {
    if (input.actor.isPlatform) return;
    const entitlement = await this.entitlements.find({ organizationId: input.actor.organizationId, module: input.module });
    if (!entitlement?.enabled) throw new ModuleDisabledError(`Module ${input.module} is not enabled`);
  }
}
