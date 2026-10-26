import { type IntegrationEvent, type IntegrationEventSubscriber, locationCreatedEventSchema } from '@modivara/core-contracts';
import type { EnsureLocationSettings } from '../application/index.js';

/** Q-05: ante un local nuevo de core, crea sus ajustes por defecto. Idempotente, así que la reentrega es inocua. */
// OPEN: igual que commerce: no filtra por entitlement y un local ya inactivo agota los 10 intentos (failed_at) en vez de ignorarse.
export class LocationCreatedSubscriber implements IntegrationEventSubscriber {
  readonly name = 'hospitality.location-created';

  constructor(private readonly ensureSettings: EnsureLocationSettings) {}

  handles(eventType: string): boolean {
    return eventType === 'core.location.created';
  }

  async handle(event: IntegrationEvent): Promise<void> {
    const { payload } = locationCreatedEventSchema.parse(event);
    await this.ensureSettings.execute({ organizationId: payload.organization_id, locationId: payload.location_id, actorUserId: payload.created_by });
  }
}
