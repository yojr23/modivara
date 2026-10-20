import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../errors.js';
import { TRANSITIONS, transition } from './transitions.js';

const at = new Date('2026-10-19T10:00:00Z');

describe('transition', () => {
  it('pending + acknowledge -> in_progress con registro', () => {
    const r = transition({ status: 'pending' }, 'acknowledge', 'u1', at);
    expect(r.status).toBe('in_progress');
    expect(r.record).toEqual({ action: 'acknowledge', fromStatus: 'pending', toStatus: 'in_progress', actorUserId: 'u1', deviceEventId: null, occurredAt: at });
  });

  it('in_progress + complete -> completed', () => {
    expect(transition({ status: 'in_progress' }, 'complete', 'u1', at).status).toBe('completed');
  });

  it.each([
    ['pending', 'complete'],
    ['in_progress', 'acknowledge'],
    ['completed', 'acknowledge'],
    ['completed', 'complete'],
  ] as const)('rechaza %s + %s', (status, action) => {
    expect(() => transition({ status }, action, 'u1', at)).toThrow(InvalidTransitionError);
  });

  it('completed es final: la tabla no tiene salidas', () => {
    expect(TRANSITIONS.completed).toEqual({});
  });
});
