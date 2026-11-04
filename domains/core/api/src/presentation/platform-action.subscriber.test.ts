import { describe, expect, it } from 'vitest';
import { newId, type IntegrationEvent } from '@modivara/core-contracts';
import { InMemoryAuditLog } from '../testing/in-memory-repositories.js';
import { PlatformActionSubscriber } from './platform-action.subscriber.js';

const event = (over: Partial<IntegrationEvent> = {}): IntegrationEvent => ({
  event_id: newId(), event_type: 'hospitality.platform_action.recorded', event_version: 1, occurred_at: '2026-11-03T10:00:00.000Z',
  organization_id: newId(), location_id: newId(), aggregate_id: newId(), correlation_id: newId(), causation_id: null,
  payload: { action: 'device.assigned', actor_user_id: newId(), target_type: 'device', target_id: newId(), details: { tableId: 'T' } },
  ...over,
});

describe('PlatformActionSubscriber', () => {
  it('maneja solo su tipo y registra actor, negocio, local, recurso y fecha', async () => {
    const audit = new InMemoryAuditLog();
    const sub = new PlatformActionSubscriber(audit);
    expect(sub.handles('hospitality.platform_action.recorded')).toBe(true);
    expect(sub.handles('hospitality.service_call.created')).toBe(false);
    const e = event();
    await sub.handle(e);
    const p = e.payload as { actor_user_id: string; target_id: string };
    expect(audit.entries).toEqual([{
      id: e.event_id, organizationId: e.organization_id, actorUserId: p.actor_user_id, action: 'device.assigned', targetType: 'device',
      targetId: p.target_id, details: { locationId: e.location_id, tableId: 'T' }, occurredAt: new Date('2026-11-03T10:00:00.000Z'),
    }]);
  });

  it('rechaza un payload que no cumple el contrato', async () => {
    await expect(new PlatformActionSubscriber(new InMemoryAuditLog()).handle(event({ payload: { action: 'otra' } }))).rejects.toThrow();
  });
});
