import { newId, NotFoundError, type ModuleEnabledEvent, type ModuleName } from '@modivara/core-contracts';
import { Entitlement, PermissionDeniedError } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { AdminTransaction, AdminTransactions } from './ports/index.js';

export interface SetModuleEnabledInput {
  actor: ActorContext;
  organizationId: string;
  module: ModuleName;
  enabled: boolean;
}

/**
 * Habilita o suspende un módulo de un negocio cliente (MOD-14/26; solo superadmin, auditado).
 * En la misma transacción publica `core.module.enabled|disabled` por cada local activo, para que el dominio inicialice
 * los locales que ya existían (activación tardía). Suspender no borra datos: el guard de módulo responde 403 `module_disabled`.
 * Sin cambio: suspender de nuevo no hace nada; **habilitar de nuevo re-publica** `core.module.enabled` sin auditar (recuperación
 * del operador si el dominio no estaba compuesto en el host cuando se habilitó; los consumidores son idempotentes, OPERACION-001 §9).
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
      const changed = entitlement.enabled !== enabled;
      if (!changed && !enabled) return entitlement;

      const now = new Date();
      if (changed) {
        entitlement.setEnabled(enabled);
        await tx.entitlements.save(entitlement);
        const action = enabled ? 'entitlement.enabled' : 'entitlement.disabled';
        await tx.audit.record({ id: newId(), organizationId, actorUserId: actor.actorUserId, action, targetType: 'entitlement', targetId: organizationId, details: { module }, occurredAt: now });
      }
      await appendModuleEvents(tx, { organizationId, module, enabled, actorUserId: actor.actorUserId, locations: await tx.locations.listActive({ organizationId }), now });
      return entitlement;
    });
  }
}

/** `core.module.enabled|disabled` por local, en la transacción de quien cambia el entitlement (también ProvisionOrganization). */
export async function appendModuleEvents(
  tx: AdminTransaction,
  e: { organizationId: string; module: ModuleName; enabled: boolean; actorUserId: string; locations: readonly { id: string }[]; now: Date },
): Promise<void> {
  for (const location of e.locations) {
    await tx.outbox.append({
      eventId: newId(), eventType: e.enabled ? 'core.module.enabled' : 'core.module.disabled', eventVersion: 1, occurredAt: e.now, organizationId: e.organizationId,
      locationId: location.id, aggregateId: e.organizationId, correlationId: newId(), causationId: null,
      payload: { module: e.module, organization_id: e.organizationId, location_id: location.id, changed_by: e.actorUserId } satisfies ModuleEnabledEvent['payload'],
    });
  }
}
