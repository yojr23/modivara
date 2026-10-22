import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayRateLimiter } from './gateway-rate-limiter.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('GatewayRateLimiter', () => {
  it('permite la ráfaga y rechaza lo que la excede; solo el primer rechazo de la ventana pide registrar', () => {
    const l = new GatewayRateLimiter({ perSecond: 2, burst: 3 });
    expect([1, 2, 3].map(() => l.tryAcquire('a'))).toEqual(['allow', 'allow', 'allow']);
    expect([l.tryAcquire('a'), l.tryAcquire('a'), l.tryAcquire('a')]).toEqual(['deny_first', 'deny', 'deny']);
  });

  it('recupera fichas con el tiempo y vuelve a avisar tras la ventana de log', () => {
    const l = new GatewayRateLimiter({ perSecond: 2, burst: 2 });
    l.tryAcquire('a'); l.tryAcquire('a');
    expect(l.tryAcquire('a')).toBe('deny_first');
    vi.advanceTimersByTime(500); // 1 ficha
    expect(l.tryAcquire('a')).toBe('allow');
    expect(l.tryAcquire('a')).toBe('deny');
    vi.advanceTimersByTime(61_000);
    l.tryAcquire('a'); l.tryAcquire('a');
    expect(l.tryAcquire('a')).toBe('deny_first');
  });

  it('cada gateway tiene su cubo', () => {
    const l = new GatewayRateLimiter({ perSecond: 1, burst: 1 });
    expect(l.tryAcquire('a')).toBe('allow');
    expect(l.tryAcquire('a')).not.toBe('allow');
    expect(l.tryAcquire('b')).toBe('allow');
  });
});
