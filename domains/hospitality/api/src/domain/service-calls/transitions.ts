import type { CallAction, CallStatus } from '@modivara/hospitality-contracts';
import { InvalidTransitionError } from '../errors.js';

export type TransitionAction = Exclude<CallAction, 'create'>;

/** Tabla de transiciones (TECH-001 §16.4). `completed` es final; no hay cancelación. */
export const TRANSITIONS: Readonly<Record<CallStatus, Readonly<Partial<Record<TransitionAction, CallStatus>>>>> = {
  pending: { acknowledge: 'in_progress' },
  in_progress: { complete: 'completed' },
  completed: {},
};

/** Fila de `service_call_transitions` (DATA-001 §3). */
export interface CallTransitionRecord {
  action: CallAction;
  fromStatus: CallStatus | null;
  toStatus: CallStatus;
  /** null cuando el origen es un botón. */
  actorUserId: string | null;
  deviceEventId: string | null;
  occurredAt: Date;
}

/** Función pura: valida la acción contra la tabla y devuelve el estado nuevo + el registro a persistir. */
export function transition(
  call: { status: CallStatus },
  action: TransitionAction,
  actorId: string,
  at: Date,
): { status: CallStatus; record: CallTransitionRecord } {
  const next = TRANSITIONS[call.status][action];
  if (!next) throw new InvalidTransitionError(call.status, action);
  return {
    status: next,
    record: { action, fromStatus: call.status, toStatus: next, actorUserId: actorId, deviceEventId: null, occurredAt: at },
  };
}
