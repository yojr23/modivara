import { describe, expect, it } from 'vitest';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { type IntegrationEvent, newId } from '@modivara/core-contracts';
import { createHarness } from '../testing/harness.js';
import { LOC, ORG, USER } from '../testing/fixtures.js';
import { LocationCreatedSubscriber } from './location-created.subscriber.js';

const event = (over: Partial<IntegrationEvent> = {}): IntegrationEvent => ({
  event_id: newId(), event_type: 'core.location.created', event_version: 1, occurred_at: new Date().toISOString(), organization_id: ORG, location_id: LOC,
  aggregate_id: LOC, correlation_id: newId(), causation_id: null,
  payload: { location_id: LOC, organization_id: ORG, organization_slug: 'bar', location_name: 'Principal', timezone: 'America/Bogota', created_by: USER },
  ...over,
});

describe('LocationCreatedSubscriber (commerce)', () => {
  const build = () => {
    const h = createHarness();
    h.core.add({ id: LOC, organizationId: ORG });
    return { h, subscriber: new LocationCreatedSubscriber(h.seedMovementReasons, h.ensureDefaultStockLocation) };
  };

  it('solo maneja core.location.created', () => {
    const { subscriber } = build();
    expect([subscriber.handles('core.location.created'), subscriber.handles('hospitality.service_call.created')]).toEqual([true, false]);
  });

  it('siembra los motivos y «Principal», y reentregar el mismo evento no duplica nada', async () => {
    const { h, subscriber } = build();
    const e = event();
    await subscriber.handle(e);
    await subscriber.handle(e);
    expect(await h.reasons.list({ organizationId: ORG })).toHaveLength(SEEDED_MOVEMENT_REASONS.length);
    expect((await h.stockLocations.list({ organizationId: ORG, locationId: LOC })).map((s) => [s.name, s.isDefault])).toEqual([['Principal', true]]);
  });

  it('un payload inválido se rechaza (el poller lo reintenta)', async () => {
    const { subscriber } = build();
    await expect(subscriber.handle(event({ payload: { location_id: 'x' } }))).rejects.toThrow();
  });
});
