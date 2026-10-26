import type { CoreAccessPort } from '@modivara/core-contracts';
import type { LocationSettingsRepository } from './ports/index.js';
import { type ActorContext, requireActiveLocation } from './support.js';

/** Crea la fila de `location_settings` con los valores por defecto si el local aún no la tiene (idempotente). */
export class EnsureLocationSettings {
  constructor(private readonly core: CoreAccessPort, private readonly settings: LocationSettingsRepository) {}

  async execute(ctx: ActorContext): Promise<void> {
    await requireActiveLocation(this.core, ctx);
    await this.settings.ensureDefault({ organizationId: ctx.organizationId, locationId: ctx.locationId }, ctx.actorUserId);
  }
}
