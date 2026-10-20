import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { CallActionInput } from './acknowledge-call.js';
import type { NotificationPort, ServiceCallRepository } from './ports/index.js';
import { notifyAfterSave, owned, scopeOf } from './support.js';

export class CompleteCall {
  constructor(
    private readonly calls: ServiceCallRepository,
    private readonly notifications: NotificationPort,
  ) {}

  async execute(input: CallActionInput): Promise<ServiceCall> {
    const call = owned(await this.calls.findById({ ...scopeOf(input), id: input.callId }), input, 'service call');
    call.complete(input.actorUserId, new Date());
    await this.calls.save(call);
    await notifyAfterSave(this.notifications, 'completed', call);
    return call;
  }
}
