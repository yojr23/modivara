import { type IntegrationEvent, type IntegrationEventSubscriber } from '@modivara/core-contracts';
import { platformActionRecordedEventSchema } from '@modivara/hospitality-contracts';
import type { AuditLog } from '../application/ports/index.js';

/**
 * ADR-002 D3: las acciones del superadmin en hospitality (gateways, botones) llegan por su outbox y quedan en `core.audit_log`.
 * El `event_id` es el id de la fila, así que la reentrega (at-least-once) no duplica. El local no tiene columna propia: va en `details`.
 */
export class PlatformActionSubscriber implements IntegrationEventSubscriber {
  readonly name = 'core.platform-action-audit';

  constructor(private readonly audit: AuditLog) {}

  handles(eventType: string): boolean {
    return eventType === 'hospitality.platform_action.recorded';
  }

  async handle(event: IntegrationEvent): Promise<void> {
    const e = platformActionRecordedEventSchema.parse(event);
    await this.audit.record({
      id: e.event_id,
      organizationId: e.organization_id,
      actorUserId: e.payload.actor_user_id,
      action: e.payload.action,
      targetType: e.payload.target_type,
      targetId: e.payload.target_id,
      details: { locationId: e.location_id, ...e.payload.details },
      occurredAt: new Date(e.occurred_at),
    });
  }
}
