import { NotFoundError } from '../domain/errors.js';
import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { CallActionInput } from './acknowledge-call.js';
import type { Clock, NotificationPort, ServiceCallRepository } from './ports/index.js';
import { notifyAfterSave } from './support.js';

export class CompleteCall {
  constructor(
    private readonly calls: ServiceCallRepository,
    private readonly notifications: NotificationPort,
    private readonly clock: Clock,
  ) {}

  async execute(input: CallActionInput): Promise<ServiceCall> {
    const call = await this.calls.findById(input.callId, input.locationId);
    if (!call) throw new NotFoundError('service call');
    call.complete(input.actorId, this.clock.now());
    await this.calls.save(call);
    await notifyAfterSave(this.notifications, 'completed', call);
    return call;
  }
}
