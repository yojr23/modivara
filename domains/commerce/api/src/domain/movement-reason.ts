import { type MovementDirection, MOVEMENT_DIRECTIONS } from '@modivara/commerce-contracts';
import { InactiveEntityError, InvalidValueError } from './errors.js';
import { requireText } from './name.js';

export interface MovementReasonProps {
  id: string;
  organizationId: string;
  name: string;
  direction: MovementDirection;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface CreateMovementReasonInput {
  id: string;
  organizationId: string;
  name: string;
  direction: MovementDirection;
  actorUserId: string;
  now: Date;
}

/** Motivo de movimiento por negocio. La dirección es inmutable: los movimientos ya registrados dependen de ella. */
export class MovementReason {
  private constructor(private props: MovementReasonProps) {}

  static create(input: CreateMovementReasonInput): MovementReason {
    if (!MOVEMENT_DIRECTIONS.includes(input.direction)) {
      throw new InvalidValueError(`Dirección inválida: ${input.direction}`);
    }
    return new MovementReason({
      id: input.id,
      organizationId: input.organizationId,
      name: requireText('El nombre', input.name),
      direction: input.direction,
      deactivatedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    });
  }

  static restore(props: MovementReasonProps): MovementReason {
    return new MovementReason({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get name() { return this.props.name; }
  get direction() { return this.props.direction; }
  get isActive() { return this.props.deactivatedAt === null; }

  deactivate(actorUserId: string, now: Date): void {
    if (!this.isActive) throw new InactiveEntityError('El motivo ya está desactivado');
    this.props.deactivatedAt = now;
    this.props.updatedAt = now;
    this.props.updatedBy = actorUserId;
  }

  toProps(): MovementReasonProps {
    return { ...this.props };
  }
}
