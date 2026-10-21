import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiErrorSchema, loginResponseSchema, meResponseSchema, SESSION_COOKIE } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore } from '../testing/integration.js';
import { createTestApp, PASSWORD, seedScenario, type TestApp } from '../testing/http.js';

// F1-06: HTTP real (supertest sobre Nest) contra db-test.
const db = corePrismaForTests();
let t: TestApp;
let s: Awaited<ReturnType<typeof seedScenario>>;

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetCore(db);
  s = await seedScenario(t.get);
});
afterAll(async () => {
  await t.app.close();
  await db.$disconnect();
});

const login = (body: object, origin?: string) => {
  const req = t.http().post('/api/v1/auth/login');
  return (origin ? req.set('Origin', origin) : req).send(body);
};
const good = { slug: 'bar-demo', username: 'admin', password: PASSWORD };

describe('POST /auth/login', () => {
  it('login válido fija la cookie HttpOnly; Secure; SameSite=Strict; Path=/ con expiración a 30 días', async () => {
    const res = await login(good);
    expect(res.status).toBe(200);
    const body = loginResponseSchema.parse(res.body);
    expect(body.actor).toMatchObject({ username: 'admin', is_platform: false, organization_id: s.demo.organization.id });
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[^;]+`));
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(cookie).toContain(attr);
    const expires = new Date(/Expires=([^;]+)/.exec(cookie)![1]!).getTime();
    expect(Math.abs(expires - new Date(body.expires_at).getTime())).toBeLessThan(1500);
    expect(expires - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
  });

  it('Origin ajeno -> 403 y no crea sesión; el mismo host pasa', async () => {
    const res = await login(good, 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await db.session.count()).toBe(0);
    expect((await login(good, 'null')).status).toBe(403);
    expect((await login(good, t.origin)).status).toBe(200);
  });

  it('usuario inexistente, contraseña errónea y negocio inexistente responden exactamente igual', async () => {
    const wrongPassword = await login({ ...good, password: 'Wrong1234' });
    const noUser = await login({ ...good, username: 'fantasma' });
    const noOrg = await login({ ...good, slug: 'no-existe' });
    expect(wrongPassword.status).toBe(401);
    for (const r of [noUser, noOrg]) {
      expect(r.status).toBe(wrongPassword.status);
      expect(r.body).toEqual(wrongPassword.body);
    }
    expect(apiErrorSchema.parse(wrongPassword.body).code).toBe('invalid_credentials');
  });

  it('cuerpo inválido -> 400 validation', async () => {
    const res = await login({ slug: 'bar-demo' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation');
  });

  it('cuenta bloqueada responde igual que un usuario inexistente (401 invalid_credentials) y sigue bloqueada', async () => {
    for (let i = 0; i < 5; i++) await login({ ...good, password: 'Wrong1234' });
    const locked = await login(good); // contraseña correcta, pero bloqueada
    const ghost = await login({ ...good, username: 'fantasma' });
    expect(locked.status).toBe(401);
    expect(locked.status).toBe(ghost.status);
    expect(locked.body).toEqual(ghost.body);
    expect(locked.body.code).toBe('invalid_credentials');
    expect(locked.headers['set-cookie']).toBeUndefined();
    expect(await db.session.count()).toBe(0);
  });
});

describe('límite por IP del login', () => {
  it('429 con Retry-After al pasar el máximo de la ventana', async () => {
    const limited = await createTestApp({ unlimited: false });
    try {
      let last = 0;
      let res;
      for (let i = 0; i < 31 && last !== 429; i++) {
        res = await limited.http().post('/api/v1/auth/login').send({ ...good, password: 'Wrong1234' });
        last = res.status;
      }
      expect(last).toBe(429);
      expect(res!.body.code).toBe('too_many_requests');
      expect(Number(res!.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.app.close();
    }
  });
});

describe('GET /me y POST /auth/logout', () => {
  it('sin sesión o con cookie basura -> 401', async () => {
    expect((await t.http().get('/api/v1/me')).status).toBe(401);
    const res = await t.http().get('/api/v1/me').set('Cookie', `${SESSION_COOKIE}=basura`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('session_invalid');
  });

  it('con sesión devuelve actor, negocio, módulos y locales con permisos efectivos', async () => {
    const cookie = await t.loginAs('bar-demo', 'admin');
    const res = await t.http().get('/api/v1/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(res.body);
    expect(me.organization).toMatchObject({ slug: 'bar-demo' });
    expect(me.modules).toEqual(['hospitality']);
    expect(me.locations).toHaveLength(1);
    expect(me.locations[0]!.permissions).toContain('core.users.manage');
    // Renueva la cookie (sesión deslizante).
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toContain('Expires=');

    const staff = meResponseSchema.parse((await t.http().get('/api/v1/me').set('Cookie', await t.loginAs('bar-demo', 'mesero'))).body);
    expect(staff.locations[0]!.permissions).not.toContain('core.users.manage');
  });

  it('logout revoca la sesión y limpia la cookie; repetirlo no falla', async () => {
    const cookie = await t.loginAs('bar-demo', 'admin');
    const out = await t.http().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(204);
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toContain(`${SESSION_COOKIE}=;`);
    expect((await t.http().get('/api/v1/me').set('Cookie', cookie)).status).toBe(401);
    expect((await t.http().post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(204);
  });

  it('logout con Origin ajeno -> 403 (la sesión sigue viva)', async () => {
    const cookie = await t.loginAs('bar-demo', 'admin');
    expect((await t.http().post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await t.http().get('/api/v1/me').set('Cookie', cookie)).status).toBe(200);
  });
});
