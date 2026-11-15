import {
  type CoreAccessPort, type IntegrationEvent, type IntegrationEventSubscriber, locationCreatedEventSchema, moduleEnabledEventSchema,
} from '@modivara/core-contracts';
import type { EnsureDefaultStockLocation, SeedMovementReasons } from '../application/index.js';

/**
 * Q-05 y MOD-14: inicializa un local para commerce (motivos del negocio y «Principal») ante un local nuevo de core o la habilitación tardía
 * del módulo (`core.module.enabled`, uno por local activo). Ambos casos de uso son idempotentes: la reentrega o reactivar no duplica.
 * Si el negocio no tiene commerce, o el local ya no está disponible, no hace nada (no reintenta hasta `failed_at`).
 */
export class LocationCreatedSubscriber implements IntegrationEventSubscriber {
  readonly name = 'commerce.location-created';

  constructor(
    private readonly seedReasons: SeedMovementReasons,
    private readonly ensureDefault: EnsureDefaultStockLocation,
    private readonly core: CoreAccessPort,
  ) {}

  handles(eventType: string): boolean {
    return eventType === 'core.location.created' || eventType === 'core.module.enabled';
  }

  async handle(event: IntegrationEvent): Promise<void> {
    const ctx = contextOf(event);
    if (!ctx) return;
    const location = await this.core.getLocation(ctx.locationId);
    if (!location?.active || location.organizationId !== ctx.organizationId) return;
    if (!(await this.core.isModuleEnabled(ctx.organizationId, 'commerce'))) return;
    await this.seedReasons.execute(ctx);
    await this.ensureDefault.execute(ctx);
  }
}

function contextOf(event: IntegrationEvent) {
  if (event.event_type === 'core.module.enabled') {
    const p = moduleEnabledEventSchema.parse(event).payload;
    return p.module === 'commerce' ? { organizationId: p.organization_id, locationId: p.location_id, actorUserId: p.changed_by } : null;
  }
  const p = locationCreatedEventSchema.parse(event).payload;
  return { organizationId: p.organization_id, locationId: p.location_id, actorUserId: p.created_by };
}
