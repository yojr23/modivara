import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { DomainError } from '@modivara/core-contracts';
import {
  ConcurrencyConflictError, DeviceAlreadyAssignedError, DuplicateError, InvalidStateError, InvalidTransitionError, TableInUseError,
} from '../domain/errors.js';

type Res = { status(code: number): { json(body: unknown): void } };

/**
 * Los errores propios de hospitality se responden 409 con su `code`. El filtro global de core solo conoce los códigos de core
 * (un código ajeno sería 500); este filtro de controlador atiende únicamente estos y deja pasar el resto al global.
 */
@Catch(DuplicateError, DeviceAlreadyAssignedError, TableInUseError, ConcurrencyConflictError, InvalidTransitionError, InvalidStateError)
export class HospitalityConflictFilter implements ExceptionFilter {
  catch(error: DomainError, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Res>().status(409).json({ code: error.code, message: error.message });
  }
}
