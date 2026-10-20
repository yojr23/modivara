import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { NotificationPort, ServiceCallRepository } from './ports/index.js';
import { type ActorContext, notifyAfterSave, owned } from './support.js';

export interface CallActionInput extends ActorContext {
  callId: string;
}

export class AcknowledgeCall {
  constructor(
    private readonly calls: ServiceCallRepository,
    private readonly notifications: NotificationPort,
  ) {}

  async execute(input: CallActionInput): Promise<ServiceCall> {
    const call = owned(await this.calls.findById(input.callId, input.locationId), input, 'service call');
    call.acknowledge(input.actorUserId, new Date());
    await this.calls.save(call); // ConcurrencyConflictError -> 409 con el estado actual
    await notifyAfterSave(this.notifications, 'acknowledged', call);
    return call;
  }
}
