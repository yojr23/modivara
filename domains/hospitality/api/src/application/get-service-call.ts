import type { CoreAccessPort } from '@modivara/core-contracts';
import type { ServiceCallDetailDto } from '@modivara/hospitality-contracts';
import { NotFoundError } from '../domain/errors.js';
import { canSeeCall } from '../domain/service-calls/visibility.js';
import type { CallViews } from './call-view.js';
import type { LocationSettingsRepository, ServiceCallRepository } from './ports/index.js';
import { owned, type PermittedContext, requireActiveLocation, scopeOf } from './support.js';

export interface GetServiceCallInput extends PermittedContext {
  callId: string;
}

/** Un llamado con su historia de transiciones y los nombres de quienes actuaron. Otro local/negocio o no visible: 404. */
export class GetServiceCall {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly calls: ServiceCallRepository,
    private readonly views: CallViews,
    private readonly settings: LocationSettingsRepository,
  ) {}

  async execute(input: GetServiceCallInput): Promise<ServiceCallDetailDto> {
    await requireActiveLocation(this.core, input);
    const scope = scopeOf(input);
    const call = owned(await this.calls.findById({ ...scope, id: input.callId }), input, 'service call');
    const { callVisibility } = await this.settings.get(scope);
    if (!canSeeCall(input, call, callVisibility)) throw new NotFoundError('service call');
    const transitions = await this.calls.listTransitions({ ...scope, id: call.id });
    const names = await this.core.userDisplayNames({
      organizationId: input.organizationId,
      userIds: [...new Set(transitions.flatMap((t) => (t.actorUserId ? [t.actorUserId] : [])))],
    });
    return {
      ...(await this.views.one(call)),
      transitions: transitions.map((t) => ({
        action: t.action,
        from_status: t.fromStatus,
        to_status: t.toStatus,
        occurred_at: t.occurredAt.toISOString(),
        actor_user_id: t.actorUserId,
        actor_name: (t.actorUserId && names.get(t.actorUserId)) || null,
        device_event_id: t.deviceEventId,
      })),
    };
  }
}
