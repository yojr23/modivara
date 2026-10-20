import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUser } from './app-user.js';
import { InvalidValueError } from './errors.js';

const make = () =>
  AppUser.create({ id: 'u1', organizationId: 'o1', username: 'ana', displayName: 'Ana', passwordHash: 'h', now: new Date() });
const fail = (u: AppUser, times: number) => { for (let i = 0; i < times; i++) u.registerFailedLogin(new Date()); };

describe('AppUser', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('valida username (minúsculas, formato) y datos', () => {
    expect(() => AppUser.create({ id: 'u', organizationId: 'o', username: 'Ana', displayName: 'A', passwordHash: 'h', now: new Date() })).toThrow(InvalidValueError);
    expect(() => AppUser.create({ id: 'u', organizationId: 'o', username: 'ana', displayName: ' ', passwordHash: 'h', now: new Date() })).toThrow(InvalidValueError);
    expect(() => AppUser.create({ id: 'u', organizationId: 'o', username: 'ana', displayName: 'A', passwordHash: '', now: new Date() })).toThrow(InvalidValueError);
  });

  it('no se bloquea con 4 fallos', () => {
    const u = make();
    fail(u, 4);
    expect(u.lockedUntil(new Date())).toBeNull();
  });

  it('se bloquea con 5 fallos hasta que vence la ventana de 15 minutos', () => {
    const u = make();
    fail(u, 5);
    expect(u.lockedUntil(new Date())).toEqual(new Date('2026-10-19T10:15:00Z'));
    vi.advanceTimersByTime(14 * 60_000 + 59_000);
    expect(u.lockedUntil(new Date())).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(u.lockedUntil(new Date())).toBeNull();
  });

  it('fallos fuera de la ventana reinician el conteo', () => {
    const u = make();
    fail(u, 4);
    vi.advanceTimersByTime(15 * 60_000);
    fail(u, 1);
    expect(u.failedLoginCount).toBe(1);
    expect(u.lockedUntil(new Date())).toBeNull();
  });

  it('un login correcto limpia el contador', () => {
    const u = make();
    fail(u, 3);
    expect(u.registerSuccessfulLogin()).toBe(true);
    expect(u.registerSuccessfulLogin()).toBe(false);
    expect(u.failedLoginCount).toBe(0);
  });

  it('cambiar la contraseña libera el bloqueo y registra la fecha', () => {
    const u = make();
    fail(u, 5);
    vi.advanceTimersByTime(1000);
    u.changePassword('h2', new Date());
    expect(u.lockedUntil(new Date())).toBeNull();
    expect(u.passwordHash).toBe('h2');
    expect(u.passwordChangedAt).toEqual(new Date());
  });
});
