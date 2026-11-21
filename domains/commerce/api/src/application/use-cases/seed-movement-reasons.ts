import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { newId } from '@modivara/core-contracts';
import { MovementReason } from '../../domain/movement-reason.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ActorContext } from './shared.js';

/**
 * Siembra los motivos de DATA-001 §4 para un negocio. Idempotente: omite los que ya existen, activos o no; un motivo por
 * defecto que el admin desactivó no vuelve al reactivar commerce (MOD-26).
 */
export class SeedMovementReasons {
  constructor(
    private readonly reasons: MovementReasonRepository,
  ) {}

  async execute(input: ActorContext): Promise<MovementReason[]> {
    const created: MovementReason[] = [];
    const existing = new Set((await this.reasons.list({ organizationId: input.organizationId })).map((r) => r.name.toLocaleLowerCase('es')));
    for (const seed of SEEDED_MOVEMENT_REASONS) {
      if (existing.has(seed.name.toLocaleLowerCase('es'))) continue;
      const reason = MovementReason.create({ ...seed, ...input, id: newId(), now: new Date() });
      await this.reasons.save(reason);
      created.push(reason);
    }
    return created;
  }
}
