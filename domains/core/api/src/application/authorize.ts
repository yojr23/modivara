import { permissionsFor, type ModuleName, type Permission } from '@modivara/core-contracts';
import { ModuleDisabledError } from '../domain/index.js';
import { assertEffective } from './effective-permissions.js';
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
   * Sin él: en cualquiera de sus locales, o por ser dueño. Además el permiso debe ser efectivo: su módulo y su fuente habilitados
   * (misma regla que `/me`, `effective-permissions.ts`).
   */
  async permission(input: { actor: ActorContext; permission: Permission; locationId?: string }): Promise<void> {
    const { actor, permission } = input;
    if (actor.isPlatform) return;
    if (input.locationId) {
      const { granted, modules } = await this.access.execute({ actor, locationId: input.locationId });
      assertEffective(permission, granted.has(permission), modules);
      return;
    }
    const { organizationId, actorUserId } = actor;
    // Un dueño es admin en todos sus locales, aunque aún no tenga membresías.
    const granted = (actor.isOwner && permissionsFor(['admin'], actor).has(permission))
      || (await this.memberships.listActiveByUser({ organizationId, userId: actorUserId })).some((m) => permissionsFor(m.roles, actor).has(permission));
    assertEffective(permission, granted, granted ? await this.entitlements.listEnabledModules({ organizationId }) : []);
  }

  async module(input: { actor: ActorContext; module: ModuleName }): Promise<void> {
    if (input.actor.isPlatform) return;
    const entitlement = await this.entitlements.find({ organizationId: input.actor.organizationId, module: input.module });
    if (!entitlement?.enabled) throw new ModuleDisabledError(`Module ${input.module} is not enabled`);
  }
}
