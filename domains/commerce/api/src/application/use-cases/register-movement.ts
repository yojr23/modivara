import { type CoreAccessPort, newId } from '@modivara/core-contracts';
import type { MovementDirection } from '@modivara/commerce-contracts';
import type { MovementChange } from '../../domain/stock-movement.js';
import { Quantity } from '../../domain/quantity.js';
import { NotFoundError } from '../../domain/errors.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ProductRepository } from '../ports/product.repository.js';
import type { RecordedMovement, StockLedger } from '../ports/stock-ledger.port.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';
import { type StockContext, requireLocation, requireProduct, requireStockLocation } from './shared.js';

export interface MovementTarget extends StockContext {
  stockLocationId: string;
  productId: string;
  reasonId: string;
  note?: string;
  idempotencyKey: string;
}

export interface RegisterMovementCommand extends MovementTarget {
  direction: MovementDirection;
  /** in/out: magnitud > 0. adjust: delta con signo ≠ 0. Texto decimal, nunca number. */
  quantity: string;
}

/** Carga y valida las referencias y delega el registro atómico al ledger. Compartido con AdjustToCount. */
export class MovementRecorder {
  constructor(
    private readonly products: ProductRepository,
    private readonly stockLocations: StockLocationRepository,
    private readonly reasons: MovementReasonRepository,
    private readonly ledger: StockLedger,
    private readonly core: CoreAccessPort,
  ) {}

  async record(target: MovementTarget, change: MovementChange): Promise<RecordedMovement> {
    const { organizationId, locationId } = target;
    await requireLocation(this.core, organizationId, locationId);
    const stockLocation = await requireStockLocation(this.stockLocations, { id: target.stockLocationId, organizationId, locationId });
    const product = await requireProduct(this.products, { id: target.productId, organizationId, locationId });
    const reason = await this.reasons.findById({ id: target.reasonId, organizationId });
    if (!reason) throw new NotFoundError('Movement reason');

    return this.ledger.record({
      id: newId(),
      eventId: newId(),
      product,
      stockLocation,
      reason,
      change,
      note: target.note,
      actorUserId: target.actorUserId,
      idempotencyKey: target.idempotencyKey,
      occurredAt: new Date(),
    });
  }
}

export class RegisterMovement {
  constructor(private readonly recorder: MovementRecorder) {}

  async execute(input: RegisterMovementCommand): Promise<RecordedMovement> {
    const quantity = Quantity.parse(input.quantity);
    const change: MovementChange =
      input.direction === 'adjust' ? { kind: 'adjust', delta: quantity } : { kind: input.direction, quantity };
    return this.recorder.record(input, change);
  }
}
