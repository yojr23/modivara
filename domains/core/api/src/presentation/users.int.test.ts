import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userResponseSchema, usersResponseSchema } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore } from '../testing/integration.js';
import { createTestApp, PASSWORD, seedScenario, type TestApp } from '../testing/http.js';

// F1-09: administración de usuarios por HTTP. bar-demo = A, bar-demo-pisos = B.
const db = corePrismaForTests();
let t: TestApp;
let s: Awaited<ReturnType<typeof seedScenario>>;
let admin: string, mesero: string;

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetCore(db);
  s = await seedScenario(t.get);
  admin = await t.loginAs('bar-demo', 'admin');
  mesero = await t.loginAs('bar-demo', 'mesero');
});
afterAll(async () => {
  await t.app.close();
  await db.$disconnect();
});

const post = (path: string, cookie: string, body?: object) => t.http().post(`/api/v1${path}`).set('Cookie', cookie).send(body);
const newStaff = { username: 'mesero2', display_name: 'Mesero 2', password: PASSWORD };

describe('alta de usuarios', () => {
  it('admin crea un usuario del negocio; ese usuario puede iniciar sesión', async () => {
    const res = await post('/users', admin, newStaff);
    expect(res.status).toBe(201);
    expect(userResponseSchema.parse(res.body)).toMatchObject({ username: 'mesero2', is_owner: false, active: true });
    expect(res.body).not.toHaveProperty('password_hash');
    expect(await t.loginAs('bar-demo', 'mesero2')).toContain('modivara_session=');
    const row = await db.appUser.findFirstOrThrow({ where: { username: 'mesero2' } });
    expect(row.organizationId).toBe(s.demo.organization.id);
  });

  it('el alta y su auditoría quedan con el usuario que actuó', async () => {
    await post('/users', admin, newStaff);
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: 'user.created', organizationId: s.demo.organization.id }, orderBy: { occurredAt: 'desc' } });
    expect(entry.actorUserId).toBe(s.demo.userIds.admin);
  });

  it('staff no puede crear usuarios (403)', async () => {
    const res = await post('/users', mesero, newStaff);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
    expect(await db.appUser.count({ where: { username: 'mesero2' } })).toBe(0);
  });

  it('sin sesión -> 401', async () => {
    expect((await t.http().post('/api/v1/users').send(newStaff)).status).toBe(401);
  });

  it('contraseña débil rechazada con el esquema Zod (400 validation)', async () => {
    for (const password of ['corta1A', 'sinmayuscula1', 'SinNumeroAqui']) {
      const res = await post('/users', admin, { ...newStaff, password });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation');
    }
    expect(await db.appUser.count({ where: { username: 'mesero2' } })).toBe(0);
  });

  it('usuario repetido -> 409; un admin no crea dueños -> 403', async () => {
    expect((await post('/users', admin, { ...newStaff, username: 'mesero' })).status).toBe(409);
    expect((await post('/users', admin, { ...newStaff, is_owner: true })).status).toBe(403);
  });
});

describe('aislamiento entre negocios', () => {
  it('el admin de A lista solo los usuarios de A', async () => {
    const res = await t.http().get('/api/v1/users').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(usersResponseSchema.parse(res.body).users.map((u) => u.username)).toEqual(['admin', 'mesero']);
  });

  it('staff no lista usuarios', async () => {
    expect((await t.http().get('/api/v1/users').set('Cookie', mesero)).status).toBe(403);
  });

  it('usuarios de B: reset, desactivar, revocar y roles responden 404, sin cambios', async () => {
    const b = s.pisos.userIds.meserop!;
    expect((await post(`/users/${b}/password-reset`, admin, { new_password: 'Nueva1234' })).status).toBe(404);
    expect((await post(`/users/${b}/deactivate`, admin)).status).toBe(404);
    expect((await post(`/users/${b}/revoke-sessions`, admin)).status).toBe(404);
    const roles = await t.http().put(`/api/v1/users/${b}/locations/${s.demo.location.id}/roles`).set('Cookie', admin).send({ roles: ['admin'] });
    expect(roles.status).toBe(404);
    expect((await db.appUser.findUniqueOrThrow({ where: { id: b } })).deactivatedAt).toBeNull();
    expect(await t.loginAs('bar-demo-pisos', 'meserop')).toBeTruthy();
  });
});

describe('ciclo de vida', () => {
  it('reset de contraseña: la anterior deja de servir y las sesiones se revocan', async () => {
    const id = s.demo.userIds.mesero!;
    expect((await post(`/users/${id}/password-reset`, admin, { new_password: 'Nueva1234' })).status).toBe(204);
    expect((await t.http().get('/api/v1/me').set('Cookie', mesero)).status).toBe(401);
    await expect(t.loginAs('bar-demo', 'mesero')).rejects.toThrow();
    expect(await t.loginAs('bar-demo', 'mesero', 'Nueva1234')).toBeTruthy();
    expect((await post(`/users/${id}/password-reset`, admin, { new_password: 'debil' })).status).toBe(400);
  });

  it('desactivar: no puede iniciar sesión y deja de listarse', async () => {
    const id = s.demo.userIds.mesero!;
    expect((await post(`/users/${id}/deactivate`, admin)).status).toBe(204);
    expect((await t.http().get('/api/v1/me').set('Cookie', mesero)).status).toBe(401);
    await expect(t.loginAs('bar-demo', 'mesero')).rejects.toThrow();
    const list = await t.http().get('/api/v1/users').set('Cookie', admin);
    expect(list.body.users.map((u: { username: string }) => u.username)).toEqual(['admin']);
    expect((await post(`/users/${id}/deactivate`, mesero)).status).toBe(401);
  });

  it('revocar sesiones cierra las del usuario', async () => {
    expect((await post(`/users/${s.demo.userIds.mesero}/revoke-sessions`, admin)).status).toBe(204);
    expect((await t.http().get('/api/v1/me').set('Cookie', mesero)).status).toBe(401);
    expect((await t.http().get('/api/v1/me').set('Cookie', admin)).status).toBe(200);
  });

  it('roles por local: se reemplazan y se reflejan en /me; ids mal formados -> 400; local ajeno -> 404', async () => {
    const id = s.demo.userIds.mesero!;
    const put = (userId: string, locationId: string, roles: string[]) =>
      t.http().put(`/api/v1/users/${userId}/locations/${locationId}/roles`).set('Cookie', admin).send({ roles });
    const ok = await put(id, s.demo.location.id, ['staff', 'inventory']);
    expect(ok.status).toBe(200);
    expect(ok.body.roles).toEqual(['staff', 'inventory']);
    const me = await t.http().get('/api/v1/me').set('Cookie', mesero);
    expect(me.body.locations[0].permissions).toContain('commerce.stock.write');
    expect((await put(id, s.demo.location.id, ['superuser'])).status).toBe(400);
    expect((await put(id, s.demo.location.id, [])).status).toBe(400);
    expect((await put('no-es-uuid', s.demo.location.id, ['staff'])).status).toBe(400);
    expect((await put(id, s.pisos.location.id, ['staff'])).status).toBe(404);
  });

  it('Origin ajeno en una mutación -> 403', async () => {
    const res = await t.http().post('/api/v1/users').set('Cookie', admin).set('Origin', 'https://evil.example').send(newStaff);
    expect(res.status).toBe(403);
    expect(await db.appUser.count({ where: { username: 'mesero2' } })).toBe(0);
  });
});
