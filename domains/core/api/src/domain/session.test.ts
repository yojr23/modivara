import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionDeniedError } from './errors.js';
import { Session } from './session.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const make = () => Session.create({ id: 's1', userId: 'u1', tokenHash: 'abc', now: new Date() });

describe('Session', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('nace válida por 30 días', () => {
    const s = make();
    expect(s.expiresAt).toEqual(new Date('2026-11-18T10:00:00Z'));
    expect(s.isValid(new Date())).toBe(true);
  });

  it('expira a los 30 días sin uso', () => {
    const s = make();
    vi.advanceTimersByTime(30 * DAY);
    expect(s.isValid(new Date())).toBe(false);
    expect(s.touch(new Date())).toBe(false);
  });

  it('touch no escribe antes de una hora', () => {
    const s = make();
    vi.advanceTimersByTime(HOUR - 1);
    expect(s.touch(new Date())).toBe(false);
    expect(s.expiresAt).toEqual(new Date('2026-11-18T10:00:00Z'));
  });

  it('touch después de una hora renueva la expiración 30 días desde el uso', () => {
    const s = make();
    vi.advanceTimersByTime(10 * DAY);
    expect(s.touch(new Date())).toBe(true);
    expect(s.expiresAt).toEqual(new Date(Date.now() + 30 * DAY));
    expect(s.touch(new Date())).toBe(false);
  });

  it('revocada no es válida y no se renueva', () => {
    const s = make();
    s.revoke(new Date());
    vi.advanceTimersByTime(2 * HOUR);
    expect(s.isValid(new Date())).toBe(false);
    expect(s.touch(new Date())).toBe(false);
  });

  it('solo el superadmin fija actingOrganizationId', () => {
    const s = make();
    expect(() => s.actAs('o2', { isPlatform: false })).toThrow(PermissionDeniedError);
    s.actAs('o2', { isPlatform: true });
    expect(s.actingOrganizationId).toBe('o2');
    s.actAs(null, { isPlatform: true });
    expect(s.actingOrganizationId).toBeNull();
  });
});
