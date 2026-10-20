import type { MovementDirection } from '@modivara/commerce-contracts';
import { MovementReason } from '../../domain/movement-reason.js';
import { newId } from '@modivara/core-contracts';
import { ConflictError } from '../../domain/errors.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ActorContext } from './shared.js';

export class CreateMovementReason {
  constructor(private readonly reasons: MovementReasonRepository) {}

  async execute(input: ActorContext & { name: string; direction: MovementDirection }): Promise<MovementReason> {
    const reason = MovementReason.create({ ...input, id: newId(), now: new Date() });
    if (await this.reasons.findActiveByName(reason.organizationId, reason.name)) {
      throw new ConflictError(`An active reason named "${reason.name}" already exists`);
    }
    await this.reasons.save(reason);
    return reason;
  }
}
