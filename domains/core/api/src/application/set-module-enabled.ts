import { newId, NotFoundError, type ModuleEnabledEvent, type ModuleName } from '@modivara/core-contracts';
import { Entitlement, PermissionDeniedError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AdminTransactions } from './ports/index.js';

export interface SetModuleEnabledInput {
  actor: ActorContext;
  organizationId: string;
  module: ModuleName;
  enabled: boolean;
}

/**
 * Habilita o suspende un módulo de un negocio cliente (MOD-14/26; solo superadmin, auditado). Sin cambio, no hace nada.
 * En la misma transacción publica `core.module.enabled|disabled` por cada local activo, para que el dominio inicialice
 * los locales que ya existían (activación tardía). Suspender no borra datos: el guard de módulo responde 403 `module_disabled`.
 */
export class SetModuleEnabled {
  constructor(private readonly admin: AdminTransactions) {}

  async execute(input: SetModuleEnabledInput): Promise<Entitlement> {
    const { actor, organizationId, module, enabled } = input;
    if (!actor.isPlatform) throw new PermissionDeniedError('platform.entitlements.manage required');
    return this.admin.withTransaction(async (tx) => {
      const organization = await tx.organizations.findById({ id: organizationId });
      if (!organization || organization.isPlatform) throw new NotFoundError('Organization not found');
      const current = await tx.entitlements.find({ organizationId, module });
      const entitlement = current ?? Entitlement.create({ organizationId, module, enabled: false });
      if (entitlement.enabled === enabled) return entitlement;

      entitlement.setEnabled(enabled);
      await tx.entitlements.save(entitlement);
      const now = new Date();
      const action = enabled ? 'entitlement.enabled' : 'entitlement.disabled';
      await tx.audit.record({ id: newId(), organizationId, actorUserId: actor.actorUserId, action, targetType: 'entitlement', targetId: organizationId, details: { module }, occurredAt: now });
      for (const location of await tx.locations.listActive({ organizationId })) {
        await tx.outbox.append({
          eventId: newId(), eventType: enabled ? 'core.module.enabled' : 'core.module.disabled', eventVersion: 1, occurredAt: now, organizationId,
          locationId: location.id, aggregateId: organizationId, correlationId: newId(), causationId: null,
          payload: { module, organization_id: organizationId, location_id: location.id, changed_by: actor.actorUserId } satisfies ModuleEnabledEvent['payload'],
        });
      }
      return entitlement;
    });
  }
}
