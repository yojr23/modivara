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
    return { h, subscriber: new LocationCreatedSubscriber(h.seedMovementReasons, h.ensureDefaultStockLocation, h.core) };
  };

  it('maneja core.location.created y core.module.enabled', () => {
    const { subscriber } = build();
    expect(['core.location.created', 'core.module.enabled', 'core.module.disabled', 'hospitality.service_call.created'].map((t) => subscriber.handles(t)))
      .toEqual([true, true, false, false]);
  });

  it('siembra los motivos y «Principal», y reentregar el mismo evento no duplica nada', async () => {
    const { h, subscriber } = build();
    const e = event();
    await subscriber.handle(e);
    await subscriber.handle(e);
    expect(await h.reasons.list({ organizationId: ORG })).toHaveLength(SEEDED_MOVEMENT_REASONS.length);
    expect((await h.stockLocations.list({ organizationId: ORG, locationId: LOC })).map((s) => [s.name, s.isDefault])).toEqual([['Principal', true]]);
  });

  const seeded = async (h: ReturnType<typeof build>['h']) => [
    (await h.reasons.list({ organizationId: ORG })).length,
    (await h.stockLocations.list({ organizationId: ORG, locationId: LOC })).length,
  ];
  const moduleEnabled = (module: string): IntegrationEvent => event({
    event_type: 'core.module.enabled', aggregate_id: ORG, payload: { module, organization_id: ORG, location_id: LOC, changed_by: USER },
  });

  it('MOD-14: sin commerce contratado no siembra nada; un local no disponible se ignora sin error (no agota reintentos)', async () => {
    const { h, subscriber } = build();
    h.core.moduleEnabled = false;
    await subscriber.handle(event());
    expect(await seeded(h)).toEqual([0, 0]);
    h.core.moduleEnabled = true;
    h.core.add({ id: LOC, organizationId: ORG, active: false });
    await expect(subscriber.handle(event())).resolves.toBeUndefined();
    expect(await seeded(h)).toEqual([0, 0]);
  });

  it('MOD-14: core.module.enabled de commerce inicializa el local una sola vez; el de otro módulo se ignora', async () => {
    const { h, subscriber } = build();
    await subscriber.handle(moduleEnabled('hospitality'));
    expect(await seeded(h)).toEqual([0, 0]);
    await subscriber.handle(moduleEnabled('commerce'));
    await subscriber.handle(moduleEnabled('commerce'));
    expect(await seeded(h)).toEqual([SEEDED_MOVEMENT_REASONS.length, 1]);
  });

  it('un payload inválido se rechaza (el poller lo reintenta)', async () => {
    const { subscriber } = build();
    await expect(subscriber.handle(event({ payload: { location_id: 'x' } }))).rejects.toThrow();
  });
});
