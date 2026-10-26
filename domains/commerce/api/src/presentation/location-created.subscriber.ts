import { type IntegrationEvent, type IntegrationEventSubscriber, locationCreatedEventSchema } from '@modivara/core-contracts';
import type { EnsureDefaultStockLocation, SeedMovementReasons } from '../application/index.js';

/** Q-05: ante un local nuevo de core, siembra los motivos del negocio y crea «Principal». Ambos son idempotentes, así que la reentrega es inocua. */
export class LocationCreatedSubscriber implements IntegrationEventSubscriber {
  readonly name = 'commerce.location-created';

  constructor(
    private readonly seedReasons: SeedMovementReasons,
    private readonly ensureDefault: EnsureDefaultStockLocation,
  ) {}

  handles(eventType: string): boolean {
    return eventType === 'core.location.created';
  }

  async handle(event: IntegrationEvent): Promise<void> {
    const { payload } = locationCreatedEventSchema.parse(event);
    const ctx = { organizationId: payload.organization_id, locationId: payload.location_id, actorUserId: payload.created_by };
    await this.seedReasons.execute(ctx);
    await this.ensureDefault.execute(ctx);
  }
}
