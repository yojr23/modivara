import type { MovementDirection } from '@modivara/commerce-contracts';
import { MovementReason } from '../../domain/movement-reason.js';
import { ConflictError } from '../errors.js';
import type { IdGenerator } from '../ports/id-generator.port.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ActorContext } from './shared.js';

export class CreateMovementReason {
  constructor(
    private readonly reasons: MovementReasonRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: ActorContext & { name: string; direction: MovementDirection }): Promise<MovementReason> {
    const reason = MovementReason.create({ ...input, id: this.ids.next(), now: new Date() });
    if (await this.reasons.findActiveByName(reason.organizationId, reason.name)) {
      throw new ConflictError(`Ya existe un motivo activo llamado "${reason.name}"`);
    }
    await this.reasons.save(reason);
    return reason;
  }
}
