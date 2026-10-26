import { describe, expect, it } from 'vitest';
import { type IntegrationEvent, newId } from '@modivara/core-contracts';
import { EnsureLocationSettings } from '../application/index.js';
import { LocationUnavailableError } from '../domain/errors.js';
import { buildWorld } from '../testing/world.js';
import { LocationCreatedSubscriber } from './location-created.subscriber.js';

const event = (organizationId: string, locationId: string): IntegrationEvent => ({
  event_id: newId(), event_type: 'core.location.created', event_version: 1, occurred_at: new Date().toISOString(), organization_id: organizationId, location_id: locationId,
  aggregate_id: locationId, correlation_id: newId(), causation_id: null,
  payload: { location_id: locationId, organization_id: organizationId, organization_slug: 'bar', location_name: 'Principal', timezone: 'America/Bogota', created_by: newId() },
});

describe('LocationCreatedSubscriber (hospitality)', () => {
  it('crea la fila de ajustes por defecto una sola vez, aunque el evento se reentregue', async () => {
    const w = buildWorld();
    const subscriber = new LocationCreatedSubscriber(new EnsureLocationSettings(w.core, w.settings));
    expect(subscriber.handles('core.location.created')).toBe(true);
    expect(subscriber.handles('commerce.stock.received')).toBe(false);
    const e = event(w.ctx.organizationId, w.ctx.locationId);
    expect(w.settings.has(w.ctx.locationId)).toBe(false);
    await subscriber.handle(e);
    await subscriber.handle(e);
    expect(w.settings.has(w.ctx.locationId)).toBe(true);
    expect(await w.settings.get(w.ctx)).toEqual({ callVisibility: 'all' });
  });

  it('un local que core no reconoce para ese negocio no recibe fila', async () => {
    const w = buildWorld();
    const subscriber = new LocationCreatedSubscriber(new EnsureLocationSettings(w.core, w.settings));
    await expect(subscriber.handle(event(newId(), w.ctx.locationId))).rejects.toThrow(LocationUnavailableError);
    expect(w.settings.has(w.ctx.locationId)).toBe(false);
  });
});
