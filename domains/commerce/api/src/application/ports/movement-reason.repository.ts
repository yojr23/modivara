import type { MovementReason } from '../../domain/movement-reason.js';

export interface MovementReasonRepository {
  save(reason: MovementReason): Promise<void>;
  findById(organizationId: string, id: string): Promise<MovementReason | null>;
  findActiveByName(organizationId: string, name: string): Promise<MovementReason | null>;
}
