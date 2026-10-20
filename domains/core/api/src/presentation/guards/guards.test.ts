import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import {
  IS_PUBLIC_KEY, REQUEST_ACTOR_KEY, REQUIRED_MODULE_KEY, REQUIRED_PERMISSION_KEY, SESSION_COOKIE, NotFoundError,
  type ModuleName, type Permission,
} from '@modivara/core-contracts';
import { AuthenticateSession, Authorize, Login, ResolveLocationAccess } from '../../application/index.js';
import { ModuleDisabledError, PermissionDeniedError, SessionInvalidError } from '../../domain/index.js';
import { TEST_PASSWORD, World } from '../../testing/index.js';
import type { HttpRequest } from '../http.js';
import { OriginGuard } from '../origin.guard.js';
import { ModuleEnabledGuard } from './module-enabled.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { SessionGuard } from './session.guard.js';

let w: World;
let login: Login;
let sessionGuard: SessionGuard, permissionGuard: PermissionGuard, moduleGuard: ModuleEnabledGuard;

/** Contexto falso de Nest: la petición y un handler al que se le cuelgan los metadatos de los decoradores. */
function ctx(req: Partial<HttpRequest>, meta: Record<string, unknown> = {}) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  const res = { cookie: vi.fn() };
  const request = { method: 'GET', headers: {}, params: {}, ...req } as HttpRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
  return { context, request, res };
}

async function sessionOf(org: 'sol' | 'luna' | 'platform', username: string, opts: Parameters<World['addUser']>[2] = {}) {
  const o = w[org];
  await w.addUser(o, username, opts);
  const out = await login.execute({ slug: o.slug, username, password: TEST_PASSWORD });
  return out.token;
}

/** Pasa por SessionGuard como lo haría una petición real y devuelve la petición con el actor. */
async function authenticated(token: string, params: Record<string, string> = {}) {
  const c = ctx({ cookies: { [SESSION_COOKIE]: token }, params });
  await sessionGuard.canActivate(c.context);
  return c.request;
}
const withMeta = (req: HttpRequest, meta: Record<string, unknown>) => {
  const c = ctx(req, meta);
  return c.context;
};

beforeEach(async () => {
  w = await World.create();
  login = new Login(w.organizations, w.users, w.sessions, w.hasher, w.tokens);
  const access = new ResolveLocationAccess(w.locations, w.memberships, w.entitlements);
  const authorize = new Authorize(access, w.memberships, w.entitlements);
  sessionGuard = new SessionGuard(new AuthenticateSession(w.sessions, w.users, w.organizations, w.tokens));
  permissionGuard = new PermissionGuard(authorize);
  moduleGuard = new ModuleEnabledGuard(authorize);
});

describe('OriginGuard', () => {
  const guard = new OriginGuard();
  const post = (headers: Record<string, string>) => ctx({ method: 'POST', headers: { host: 'app.example', ...headers } }).context;

  it('lecturas y mutaciones sin Origin pasan; mismo host pasa', () => {
    expect(guard.canActivate(ctx({ method: 'GET', headers: { host: 'app.example', origin: 'https://evil.example' } }).context)).toBe(true);
    expect(guard.canActivate(post({}))).toBe(true);
    expect(guard.canActivate(post({ origin: 'https://app.example' }))).toBe(true);
  });

  it('Origin ajeno, con otro puerto o "null" en una mutación -> 403 (permission_denied)', () => {
    for (const origin of ['https://evil.example', 'https://app.example:8443', 'null']) {
      expect(() => guard.canActivate(post({ origin }))).toThrow(PermissionDeniedError);
    }
  });
});

describe('SessionGuard', () => {
  it('ruta pública pasa sin sesión', async () => {
    expect(await sessionGuard.canActivate(ctx({}, { [IS_PUBLIC_KEY]: true }).context)).toBe(true);
  });

  it('sin cookie, con token desconocido o con sesión revocada -> SessionInvalidError (401)', async () => {
    await expect(sessionGuard.canActivate(ctx({}).context)).rejects.toThrow(SessionInvalidError);
    await expect(sessionGuard.canActivate(ctx({ cookies: { [SESSION_COOKIE]: 'x' } }).context)).rejects.toThrow(SessionInvalidError);
    const token = await sessionOf('sol', 'ana');
    await w.sessions.revokeAllForUser({ organizationId: w.sol.id, userId: [...w.users.items.values()][0]!.id }, new Date());
    await expect(sessionGuard.canActivate(ctx({ cookies: { [SESSION_COOKIE]: token } }).context)).rejects.toThrow(SessionInvalidError);
  });

  it('sesión válida: deja el actor en la petición y renueva la cookie', async () => {
    const token = await sessionOf('sol', 'ana', { isOwner: true });
    const c = ctx({ cookies: { [SESSION_COOKIE]: token } });
    expect(await sessionGuard.canActivate(c.context)).toBe(true);
    expect(c.request[REQUEST_ACTOR_KEY]).toMatchObject({ organizationId: w.sol.id, isOwner: true, isPlatform: false });
    expect(c.res.cookie).toHaveBeenCalledWith(SESSION_COOKIE, token, expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' }));
  });
});

describe('PermissionGuard', () => {
  const need = (permission: Permission) => ({ [REQUIRED_PERMISSION_KEY]: permission });

  it('sin metadato de permiso pasa', async () => {
    expect(await permissionGuard.canActivate(withMeta(await authenticated(await sessionOf('sol', 'ana')), {}))).toBe(true);
  });

  it('staff sin core.users.manage -> PermissionDeniedError (403); admin y dueño pasan', async () => {
    const staff = await authenticated(await sessionOf('sol', 'mesero', { roles: ['staff'], location: w.solCenter }));
    await expect(permissionGuard.canActivate(withMeta(staff, need('core.users.manage')))).rejects.toThrow(PermissionDeniedError);
    const admin = await authenticated(await sessionOf('sol', 'jefe', { roles: ['admin'], location: w.solCenter }));
    expect(await permissionGuard.canActivate(withMeta(admin, need('core.users.manage')))).toBe(true);
    const owner = await authenticated(await sessionOf('sol', 'duena', { isOwner: true }));
    expect(await permissionGuard.canActivate(withMeta(owner, need('core.users.manage')))).toBe(true);
  });

  it('el superadmin pasa sin membresía', async () => {
    const root = await authenticated(await sessionOf('platform', 'root'));
    expect(await permissionGuard.canActivate(withMeta(root, need('core.users.manage')))).toBe(true);
    expect(await permissionGuard.canActivate(withMeta(root, need('platform.organizations.manage')))).toBe(true);
  });

  it('ruta por local: se exige el permiso en ESE local; un local ajeno responde "no existe"', async () => {
    const staff = await sessionOf('sol', 'mesero', { roles: ['staff'], location: w.solCenter });
    const own = await authenticated(staff, { locationId: w.solCenter.id });
    expect(await permissionGuard.canActivate(withMeta(own, need('hospitality.calls.read')))).toBe(true);
    await expect(permissionGuard.canActivate(withMeta(own, need('commerce.stock.write')))).rejects.toThrow(PermissionDeniedError);
    const foreign = await authenticated(staff, { locationId: w.lunaCenter.id });
    await expect(permissionGuard.canActivate(withMeta(foreign, need('hospitality.calls.read')))).rejects.toThrow(NotFoundError);
  });
});

describe('ModuleEnabledGuard', () => {
  const needs = (module: ModuleName) => ({ [REQUIRED_MODULE_KEY]: module });

  it('módulo habilitado pasa; deshabilitado o sin entitlement -> ModuleDisabledError (403)', async () => {
    const req = await authenticated(await sessionOf('sol', 'ana'));
    expect(await moduleGuard.canActivate(withMeta(req, needs('hospitality')))).toBe(true);
    await expect(moduleGuard.canActivate(withMeta(req, needs('commerce')))).rejects.toThrow(ModuleDisabledError);
    await expect(moduleGuard.canActivate(withMeta(req, needs('analytics')))).rejects.toThrow(ModuleDisabledError);
  });

  it('sin metadato pasa; el superadmin pasa sin entitlement', async () => {
    const root = await authenticated(await sessionOf('platform', 'root'));
    expect(await moduleGuard.canActivate(withMeta(root, {}))).toBe(true);
    expect(await moduleGuard.canActivate(withMeta(root, needs('commerce')))).toBe(true);
  });
});
