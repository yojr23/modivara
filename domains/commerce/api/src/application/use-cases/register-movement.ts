import { type CoreAccessPort, newId } from '@modivara/core-contracts';
import type { MovementDirection } from '@modivara/commerce-contracts';
import { type MovementChange, StockMovement } from '../../domain/stock-movement.js';
import { Quantity } from '../../domain/quantity.js';
import { IdempotencyKeyReusedError, NotFoundError } from '../../domain/errors.js';
import type { MovementReasonRepository } from '../ports/movement-reason.repository.js';
import type { ProductRepository } from '../ports/product.repository.js';
import type { StockLedger } from '../ports/stock-ledger.port.js';
import type { StockLocationRepository } from '../ports/stock-location.repository.js';
import { type StockContext, requireLocation, requireProduct, requireStockLocation } from './shared.js';

export interface RecordedMovement {
  movement: StockMovement;
  /** true si la idempotency_key ya existía: se devolvió el movimiento original sin aplicar nada. */
  replayed: boolean;
}

export interface MovementTarget extends StockContext {
  stockLocationId: string;
  productId: string;
  reasonId: string;
  note?: string;
  idempotencyKey: string;
  /** Solo seeds de demo (historial con fechas pasadas): los controladores nunca lo llenan; por defecto, ahora. */
  occurredAt?: Date;
}

export interface RegisterMovementCommand extends MovementTarget {
  direction: MovementDirection;
  /** in/out: magnitud > 0. adjust: delta con signo ≠ 0. Texto decimal, nunca number. */
  quantity: string;
}

/** Carga y valida las referencias y orquesta el registro: bloquea el saldo, idempotencia, `StockMovement.register` una vez y guarda. Compartido con AdjustToCount. */
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

    return this.ledger.withLockedBalance(
      { stockLocationId: stockLocation.id, productId: product.id, organizationId, locationId },
      async (tx) => {
        const existing = await tx.findByIdempotencyKey({ organizationId, idempotencyKey: target.idempotencyKey });
        if (existing) {
          // La clave es única por negocio, no por local: un movimiento de otro destino es ajeno y no se revela.
          if (existing.locationId !== locationId || existing.stockLocationId !== stockLocation.id || existing.productId !== product.id) {
            throw new IdempotencyKeyReusedError('Idempotency key already used by another movement');
          }
          return { movement: existing, replayed: true };
        }
        // Con el saldo ya bloqueado: así occurred_at crece con el orden real de los saldos (el último balance_after por fecha es el saldo actual).
        const occurredAt = target.occurredAt ?? new Date();
        const movement = StockMovement.register(tx.balance, {
          id: newId(),
          eventId: newId(),
          product,
          stockLocation,
          reason,
          change,
          note: target.note,
          actorUserId: target.actorUserId,
          idempotencyKey: target.idempotencyKey,
          occurredAt,
        });
        await tx.save(movement);
        return { movement, replayed: false };
      },
    );
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
