import { ConcurrencyConflictError, InvalidTransitionError } from '../domain/errors.js';
import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { NotificationPort, ServiceCallRepository } from './ports/index.js';
import { type ActorContext, notifyAfterSave, owned, scopeOf } from './support.js';

export interface CallActionInput extends ActorContext {
  callId: string;
}

export class AcknowledgeCall {
  constructor(
    private readonly calls: ServiceCallRepository,
    private readonly notifications: NotificationPort,
  ) {}

  /**
   * Idempotente por naturaleza: si el mismo actor ya lo reconoció y sigue en atención, devuelve el estado vigente sin nueva transición.
   * Si el estado no lo permite o cambió antes de guardar: `ConcurrencyConflictError` con el estado vigente (409).
   */
  async execute(input: CallActionInput): Promise<ServiceCall> {
    const call = owned(await this.calls.findById({ ...scopeOf(input), id: input.callId }), input, 'service call');
    if (call.status === 'in_progress' && call.acknowledgedBy === input.actorUserId) return call;
    try {
      call.acknowledge(input.actorUserId, new Date());
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new ConcurrencyConflictError(call); // la transición falla sin mutar: `call` es el estado vigente
      throw e;
    }
    try {
      await this.calls.save(call);
    } catch (e) {
      // Doble envío en paralelo del mismo actor: quien perdió la carrera recibe el mismo resultado que quien ganó.
      if (e instanceof ConcurrencyConflictError && e.current?.status === 'in_progress' && e.current.acknowledgedBy === input.actorUserId) return e.current;
      throw e; // ConcurrencyConflictError -> 409 con el estado actual
    }
    await notifyAfterSave(this.notifications, 'acknowledged', call);
    return call;
  }
}
