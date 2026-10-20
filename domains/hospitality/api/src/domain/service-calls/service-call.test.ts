import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../errors.js';
import { ServiceCall } from './service-call.js';
import { isDebounced } from './debounce.js';
import { canSeeCall } from './visibility.js';

const t0 = new Date('2026-10-19T10:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const uid = () => crypto.randomUUID();

const newCall = () =>
  ServiceCall.create({
    organizationId: uid(),
    locationId: uid(),
    table: { id: uid(), label: '5', zoneId: uid(), zoneName: 'Terraza' },
    callType: 'attention',
    deviceEventId: uid(),
    correlationId: uid(),
    now: t0,
  });


describe('ServiceCall', () => {
  it('create: pending, pressCount 1, transición create ', () => {
    const c = newCall();
    expect(c.status).toBe('pending');
    expect(c.pressCount).toBe(1);
    expect(c.persistedStatus).toBeNull();
    expect(c.transitions).toHaveLength(1);
    expect(c.transitions[0]).toMatchObject({ action: 'create', fromStatus: null, toStatus: 'pending', actorUserId: null });
  });

  it('registerPress suma y actualiza lastPressAt sin transición ni evento nuevos', () => {
    const c = newCall();
    c.markPersisted();
    c.registerPress(at(10));
    expect(c.pressCount).toBe(2);
    expect(c.lastPressAt).toEqual(at(10));
    expect(c.transitions).toHaveLength(0);
    expect(c.events).toHaveLength(0);
  });

  it('acknowledge -> complete registra actor, fechas, transiciones y eventos válidos', () => {
    const c = newCall();
    c.markPersisted();
    c.registerPress(at(5));
    c.acknowledge('u1', at(30));
    expect(c.status).toBe('in_progress');
    expect(c.acknowledgedBy).toBe('u1');
    c.complete(uid(), at(60));
    expect(c.status).toBe('completed');
    expect(c.completedAt).toEqual(at(60));
    expect(c.transitions.map((t) => t.action)).toEqual(['acknowledge', 'complete']);
    expect(c.events[0]!.payload).toMatchObject({ press_count: 2 });
  });

  it('completed es final', () => {
    const c = newCall();
    c.acknowledge('u', at(1));
    c.complete('u', at(2));
    expect(() => c.acknowledge('u', at(3))).toThrow(InvalidTransitionError);
    expect(() => c.complete('u', at(3))).toThrow(InvalidTransitionError);
  });

  it('markPersisted limpia pendientes y fija el estado cargado', () => {
    const c = newCall();
    c.markPersisted();
    expect(c.events).toHaveLength(0);
    expect(c.persistedStatus).toBe('pending');
  });
});

describe('isDebounced', () => {
  it('< 3 s descarta; >= 3 s o sin previa cuenta', () => {
    expect(isDebounced(null, t0)).toBe(false);
    expect(isDebounced(t0, at(2.9))).toBe(true);
    expect(isDebounced(t0, at(3))).toBe(false);
  });
});

describe('canSeeCall', () => {
  const call = newCall();
  const viewer = (over = {}) => ({ userId: 'u', locationId: call.locationId, permissions: new Set(['hospitality.calls.read'] as const), ...over });
  it('modo all: con permiso en el mismo local', () => expect(canSeeCall(viewer(), call, 'all')).toBe(true));
  it('sin permiso no ve', () => expect(canSeeCall(viewer({ permissions: new Set() }), call)).toBe(false));
  it('otro local no ve', () => expect(canSeeCall(viewer({ locationId: uid() }), call)).toBe(false));
});
