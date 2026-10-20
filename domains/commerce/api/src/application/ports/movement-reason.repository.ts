import type { MovementReason } from '../../domain/movement-reason.js';

/** Reasons are per business; every lookup is scoped by tenant. */
export interface MovementReasonRepository {
  save(reason: MovementReason): Promise<void>;
  findById(query: { id: string; organizationId: string }): Promise<MovementReason | null>;
  findActiveByName(query: { organizationId: string; name: string }): Promise<MovementReason | null>;
}
