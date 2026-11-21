import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { DomainError } from '@modivara/core-contracts';
import {
  ConflictError, CurrencyLockedError, CurrencyMismatchError, EmptySaleError, IdempotencyKeyReusedError, InactiveEntityError, InvalidQuantityError, InvalidValueError,
  SaleNotOpenError,
} from '../domain/errors.js';

type Res = { status(code: number): { json(body: unknown): void } };

// El filtro global de core solo conoce sus códigos (uno ajeno sería 500): estos son los propios de POS.
const STATUS: Record<string, number> = {
  invalid_value: 400,
  invalid_quantity: 400,
  inactive_entity: 409,
  sale_not_open: 409,
  empty_sale: 409,
  currency_mismatch: 409,
  currency_locked: 409,
  idempotency_key_reused: 409,
  conflict: 409,
};

@Catch(
  InvalidValueError, InvalidQuantityError, InactiveEntityError, SaleNotOpenError, EmptySaleError, CurrencyMismatchError, CurrencyLockedError, IdempotencyKeyReusedError,
  ConflictError,
)
export class PosErrorFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Res>().status(STATUS[error.code] ?? 400).json({ code: error.code, message: error.message });
  }
}
