import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AggregateRoot, toEventEnvelope, type DomainEvent } from './domain-event.js';
import { eventEnvelopeSchema } from './events.js';
import { newId } from './ids.js';
import { findActiveLocation } from './location.js';
import type { LocationRef } from './core-access.port.js';

describe('newId', () => {
  it('genera UUIDv7 válidos y ordenados por tiempo', () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(z.uuid().safeParse(a).success).toBe(true);
    expect(a < b).toBe(true);
    expect(newId()).not.toBe(newId());
  });
});

describe('findActiveLocation', () => {
  const ref: LocationRef = { id: 'l1', organizationId: 'o1', timezone: 'America/Bogota', active: true };
  const core = (r: LocationRef | null) => ({ getLocation: async () => r, isModuleEnabled: async () => true });

  it('acepta solo un local activo del mismo negocio', async () => {
    expect(await findActiveLocation(core(ref), 'o1', 'l1')).toBe(ref);
    expect(await findActiveLocation(core(ref), 'o2', 'l1')).toBeNull();
    expect(await findActiveLocation(core({ ...ref, active: false }), 'o1', 'l1')).toBeNull();
    expect(await findActiveLocation(core(null), 'o1', 'l1')).toBeNull();
  });
});

describe('AggregateRoot y toEventEnvelope', () => {
  class Thing extends AggregateRoot {
    touch(e: DomainEvent) {
      this.record(e);
    }
  }
  const event: DomainEvent = {
    eventId: newId(), eventType: 'x.y.created', eventVersion: 1, occurredAt: new Date('2026-10-20T00:00:00Z'),
    organizationId: newId(), locationId: newId(), aggregateId: newId(), correlationId: newId(), causationId: null, payload: { a: 1 },
  };

  it('pullEvents devuelve y vacía los pendientes', () => {
    const t = new Thing();
    t.touch(event);
    expect(t.pullEvents()).toEqual([event]);
    expect(t.pullEvents()).toEqual([]);
  });

  it('el sobre cumple el contrato', () => {
    expect(eventEnvelopeSchema.safeParse(toEventEnvelope(event)).success).toBe(true);
  });
});
