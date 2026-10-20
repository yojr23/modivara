import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountLockedError, InvalidCredentialsError, SessionInvalidError, WeakPasswordError } from '../domain/index.js';
import { TEST_PASSWORD, World } from '../testing/index.js';
import { AuthenticateSession } from './authenticate-session.js';
import { ChangePassword } from './change-password.js';
import { Login } from './login.js';
import { Logout } from './logout.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('login / sesión', () => {
  let w: World;
  let login: Login;
  let authenticate: AuthenticateSession;
  const attempt = (password: string, slug = 'bar-sol', username = 'ana') => login.execute({ slug, username, password });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
    w = await World.create();
    await w.addUser(w.sol, 'ana');
    login = new Login(w.organizations, w.users, w.sessions, w.hasher, w.tokens);
    authenticate = new AuthenticateSession(w.sessions, w.users, w.organizations, w.tokens);
  });
  afterEach(() => vi.useRealTimers());

  describe('Login', () => {
    it('devuelve token, actor y expiración a 30 días; guarda solo el hash', async () => {
      const out = await attempt(TEST_PASSWORD);
      expect(out.actor).toMatchObject({ organizationId: w.sol.id, isPlatform: false, isOwner: false });
      expect(out.expiresAt).toEqual(new Date('2026-11-18T10:00:00Z'));
      const stored = [...w.sessions.items.values()][0]!;
      expect(stored.tokenHash).toBe(w.tokens.hash(out.token));
    });

    it('normaliza username y slug', async () => {
      await expect(attempt(TEST_PASSWORD, 'Bar-Sol', ' ANA ')).resolves.toBeDefined();
    });

    it.each([
      ['contraseña errónea', TEST_PASSWORD + 'x', 'bar-sol', 'ana'],
      ['usuario inexistente', TEST_PASSWORD, 'bar-sol', 'nadie'],
      ['negocio inexistente', TEST_PASSWORD, 'no-existe', 'ana'],
    ])('error genérico idéntico: %s', async (_n, pw, slug, user) => {
      await expect(attempt(pw, slug, user)).rejects.toThrow(InvalidCredentialsError);
    });

    it('un usuario de otro negocio no entra por el slug equivocado', async () => {
      await expect(attempt(TEST_PASSWORD, 'bar-luna', 'ana')).rejects.toThrow(InvalidCredentialsError);
    });

    it('negocio desactivado o usuario desactivado: error genérico', async () => {
      const ana = [...w.users.items.values()][0]!;
      ana.deactivate(new Date());
      await expect(attempt(TEST_PASSWORD)).rejects.toThrow(InvalidCredentialsError);
      const bob = await w.addUser(w.luna, 'bob');
      w.luna.deactivate(new Date());
      await expect(attempt(TEST_PASSWORD, 'bar-luna', bob.username)).rejects.toThrow(InvalidCredentialsError);
    });

    it('5 fallos bloquean aunque luego llegue la contraseña correcta, hasta vencer la ventana', async () => {
      for (let i = 0; i < 5; i++) await expect(attempt('mala')).rejects.toThrow(InvalidCredentialsError);
      await expect(attempt(TEST_PASSWORD)).rejects.toThrow(AccountLockedError);
      vi.advanceTimersByTime(14 * 60_000);
      await expect(attempt(TEST_PASSWORD)).rejects.toThrow(AccountLockedError);
      vi.advanceTimersByTime(60_000);
      await expect(attempt(TEST_PASSWORD)).resolves.toBeDefined();
    });

    it('4 fallos y un acierto reinician el conteo', async () => {
      for (let i = 0; i < 4; i++) await expect(attempt('mala')).rejects.toThrow(InvalidCredentialsError);
      await attempt(TEST_PASSWORD);
      for (let i = 0; i < 4; i++) await expect(attempt('mala')).rejects.toThrow(InvalidCredentialsError);
      await expect(attempt(TEST_PASSWORD)).resolves.toBeDefined();
    });

    it('el bloqueo es por usuario y negocio: no afecta al mismo username en otro negocio', async () => {
      await w.addUser(w.luna, 'ana');
      for (let i = 0; i < 5; i++) await expect(attempt('mala')).rejects.toThrow();
      await expect(attempt(TEST_PASSWORD, 'bar-luna')).resolves.toBeDefined();
    });

    it('un usuario de la plataforma entra por /labs y es superadmin', async () => {
      await w.addUser(w.platform, 'root');
      const out = await attempt(TEST_PASSWORD, 'labs', 'root');
      expect(out.actor.isPlatform).toBe(true);
    });
  });

  describe('AuthenticateSession', () => {
    it('resuelve el actor desde el token', async () => {
      const { token, actor } = await attempt(TEST_PASSWORD);
      await expect(authenticate.execute({ token })).resolves.toEqual(actor);
    });

    it('rechaza tokens desconocidos', async () => {
      await expect(authenticate.execute({ token: 'otro' })).rejects.toThrow(SessionInvalidError);
    });

    it('expira a los 30 días sin uso', async () => {
      const { token } = await attempt(TEST_PASSWORD);
      vi.advanceTimersByTime(30 * DAY);
      await expect(authenticate.execute({ token })).rejects.toThrow(SessionInvalidError);
    });

    it('la expiración es deslizante: usar la sesión la extiende', async () => {
      const { token } = await attempt(TEST_PASSWORD);
      vi.advanceTimersByTime(20 * DAY);
      await authenticate.execute({ token });
      vi.advanceTimersByTime(20 * DAY); // 40 días desde el login, 20 desde el último uso
      await expect(authenticate.execute({ token })).resolves.toBeDefined();
    });

    it('escribe como máximo una vez por hora', async () => {
      const { token } = await attempt(TEST_PASSWORD);
      const base = w.sessions.saves;
      vi.advanceTimersByTime(HOUR - 1);
      await authenticate.execute({ token });
      await authenticate.execute({ token });
      expect(w.sessions.saves).toBe(base);
      vi.advanceTimersByTime(1);
      await authenticate.execute({ token });
      await authenticate.execute({ token });
      expect(w.sessions.saves).toBe(base + 1);
    });

    it('rechaza si el usuario o el negocio se desactivaron', async () => {
      const { token } = await attempt(TEST_PASSWORD);
      w.sol.deactivate(new Date());
      await expect(authenticate.execute({ token })).rejects.toThrow(SessionInvalidError);
    });
  });

  describe('Logout', () => {
    it('revoca la sesión y es idempotente', async () => {
      const { token } = await attempt(TEST_PASSWORD);
      const logout = new Logout(w.sessions, w.tokens);
      await logout.execute({ token });
      await logout.execute({ token });
      await logout.execute({ token: 'desconocido' });
      await expect(authenticate.execute({ token })).rejects.toThrow(SessionInvalidError);
    });
  });

  describe('ChangePassword', () => {
    it('cambia la contraseña y revoca todas las sesiones', async () => {
      const a = await attempt(TEST_PASSWORD);
      const b = await attempt(TEST_PASSWORD);
      const change = new ChangePassword(w.users, w.sessions, w.hasher);
      await change.execute({ actor: a.actor, currentPassword: TEST_PASSWORD, newPassword: 'Nueva1234' });
      await expect(authenticate.execute({ token: a.token })).rejects.toThrow(SessionInvalidError);
      await expect(authenticate.execute({ token: b.token })).rejects.toThrow(SessionInvalidError);
      await expect(attempt(TEST_PASSWORD)).rejects.toThrow(InvalidCredentialsError);
      await expect(attempt('Nueva1234')).resolves.toBeDefined();
    });

    it('exige la contraseña actual y la política', async () => {
      const { actor } = await attempt(TEST_PASSWORD);
      const change = new ChangePassword(w.users, w.sessions, w.hasher);
      await expect(change.execute({ actor, currentPassword: 'mala', newPassword: 'Nueva1234' })).rejects.toThrow(InvalidCredentialsError);
      await expect(change.execute({ actor, currentPassword: TEST_PASSWORD, newPassword: 'corta1A' })).rejects.toThrow(WeakPasswordError);
      await expect(change.execute({ actor, currentPassword: TEST_PASSWORD, newPassword: 'sinmayuscula1' })).rejects.toThrow(WeakPasswordError);
    });
  });
});
