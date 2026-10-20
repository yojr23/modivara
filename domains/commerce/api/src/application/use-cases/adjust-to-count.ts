import { Quantity } from '../../domain/quantity.js';
import type { RecordedMovement } from '../ports/stock-ledger.port.js';
import type { MovementRecorder, MovementTarget } from './register-movement.js';

export interface AdjustToCountCommand extends MovementTarget {
  /** Lo contado físicamente; el delta (contado − saldo) lo calcula el ledger dentro de la transacción. */
  countedQuantity: string;
}

export class AdjustToCount {
  constructor(private readonly recorder: MovementRecorder) {}

  async execute(input: AdjustToCountCommand): Promise<RecordedMovement> {
    return this.recorder.record(input, { kind: 'count', counted: Quantity.parse(input.countedQuantity) });
  }
}
