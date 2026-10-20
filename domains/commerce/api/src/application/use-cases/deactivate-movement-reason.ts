import { NotFoundError } from '../errors.js';
import type { Clock } from '../ports/clock.port.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ActorContext } from './shared.js';

export class DeactivateMovementReason {
  constructor(
    private readonly reasons: MovementReasonRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ActorContext & { reasonId: string }): Promise<void> {
    const reason = await this.reasons.findById(input.organizationId, input.reasonId);
    if (!reason) throw new NotFoundError('Motivo no encontrado');
    reason.deactivate(input.actorUserId, this.clock.now());
    await this.reasons.save(reason);
  }
}
