import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { DomainError } from '@modivara/core-contracts';
import {
  IdempotencyKeyReusedError, InactiveEntityError, InsufficientStockError, InvalidMovementError, InvalidQuantityError, InvalidValueError,
  QuantityOutOfRangeError, ReasonDirectionMismatchError, ScopeMismatchError,
} from '../domain/errors.js';

type Res = { status(code: number): { json(body: unknown): void } };

// El filtro global de core solo conoce sus códigos (uno ajeno sería 500): estos son los propios de commerce.
// OPEN: saldo insuficiente (`insufficient_stock`) responde 409 provisionalmente; ¿422? Lo que importa al cliente es el `code`.
const STATUS: Record<string, number> = {
  invalid_quantity: 400,
  quantity_out_of_range: 400,
  invalid_value: 400,
  invalid_movement: 400,
  reason_direction_mismatch: 400,
  scope_mismatch: 400,
  inactive_entity: 409,
  insufficient_stock: 409,
  idempotency_key_reused: 409,
};

@Catch(
  InvalidQuantityError, QuantityOutOfRangeError, InvalidValueError, InvalidMovementError, ReasonDirectionMismatchError, ScopeMismatchError,
  InactiveEntityError, InsufficientStockError, IdempotencyKeyReusedError,
)
export class CommerceErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Res>().status(STATUS[error.code] ?? 400).json({ code: error.code, message: error.message });
  }
}
