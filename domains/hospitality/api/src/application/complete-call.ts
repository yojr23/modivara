import { ConcurrencyConflictError, InvalidTransitionError } from '../domain/errors.js';
import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { CallActionInput } from './acknowledge-call.js';
import type { NotificationPort, ServiceCallRepository } from './ports/index.js';
import { notifyAfterSave, owned, scopeOf } from './support.js';

export class CompleteCall {
  constructor(
    private readonly calls: ServiceCallRepository,
    private readonly notifications: NotificationPort,
  ) {}

  /** Idempotente por naturaleza: si el mismo actor ya lo finalizó, devuelve el estado vigente sin nueva transición (ver `AcknowledgeCall`). */
  async execute(input: CallActionInput): Promise<ServiceCall> {
    const call = owned(await this.calls.findById({ ...scopeOf(input), id: input.callId }), input, 'service call');
    if (call.status === 'completed' && call.completedBy === input.actorUserId) return call;
    try {
      call.complete(input.actorUserId, new Date());
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new ConcurrencyConflictError(call);
      throw e;
    }
    try {
      await this.calls.save(call);
    } catch (e) {
      if (e instanceof ConcurrencyConflictError && e.current?.status === 'completed' && e.current.completedBy === input.actorUserId) return e.current;
      throw e;
    }
    await notifyAfterSave(this.notifications, 'completed', call);
    return call;
  }
}
