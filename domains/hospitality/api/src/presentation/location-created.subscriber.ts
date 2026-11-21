import { type IntegrationEvent, type IntegrationEventSubscriber, LocationUnavailableError, locationCreatedEventSchema } from '@modivara/core-contracts';
import type { EnsureLocationSettings } from '../application/index.js';

/**
 * Q-05: ante un local nuevo de core, crea sus ajustes por defecto. Idempotente, así que la reentrega es inocua.
 * Un local ya inactivo (o ajeno al negocio) se ignora sin error: los suscriptores de un evento se reintentan juntos y no debe agotar
 * los intentos (`failed_at`) de los demás (igual que commerce, MOD-14).
 */
// OPEN: no filtra por entitlement (la fila de ajustes es inocua sin hospitality).
// Sin activación tardía a propósito: sin fila de location_settings valen los valores por defecto, así que no hace falta `core.module.enabled`.
export class LocationCreatedSubscriber implements IntegrationEventSubscriber {
  readonly name = 'hospitality.location-created';

  constructor(private readonly ensureSettings: EnsureLocationSettings) {}

  handles(eventType: string): boolean {
    return eventType === 'core.location.created';
  }

  async handle(event: IntegrationEvent): Promise<void> {
    const { payload } = locationCreatedEventSchema.parse(event);
    try {
      await this.ensureSettings.execute({ organizationId: payload.organization_id, locationId: payload.location_id, actorUserId: payload.created_by });
    } catch (e) {
      if (!(e instanceof LocationUnavailableError)) throw e;
    }
  }
}
