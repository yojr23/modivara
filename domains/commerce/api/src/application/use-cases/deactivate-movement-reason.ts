import { NotFoundError } from '../../domain/errors.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ActorContext } from './shared.js';

export class DeactivateMovementReason {
  constructor(
    private readonly reasons: MovementReasonRepository,
  ) {}

  async execute(input: ActorContext & { reasonId: string }): Promise<void> {
    const reason = await this.reasons.findById(input.organizationId, input.reasonId);
    if (!reason) throw new NotFoundError('Movement reason');
    reason.deactivate(input.actorUserId, new Date());
    await this.reasons.save(reason);
  }
}
