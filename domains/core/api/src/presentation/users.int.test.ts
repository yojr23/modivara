import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userResponseSchema, usersResponseSchema } from '@modivara/core-contracts';
import { CreateUser, SetLocationRoles, type ActorContext } from '../application/index.js';
import { corePrismaForTests, resetCore, seedLocation } from '../testing/integration.js';
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

describe('cuentas de dueños y cuenta propia', () => {
  // El dueño lo crea el superadmin (un admin no puede crear dueños).
  async function makeOwner(username: string) {
    const root = await t.loginAs('labs', 'root');
    await t.http().put('/api/v1/platform/acting-organization').set('Cookie', root).send({ organization_id: s.demo.organization.id });
    const res = await post('/users', root, { username, display_name: username, password: PASSWORD, is_owner: true });
    expect(res.status).toBe(201);
    return { id: res.body.id as string, root };
  }

  it('un admin no dueño no puede tomar la cuenta de un dueño (404, sin cambios)', async () => {
    const { id } = await makeOwner('duena');
    expect((await post(`/users/${id}/password-reset`, admin, { new_password: 'Nueva1234' })).status).toBe(404);
    expect((await post(`/users/${id}/deactivate`, admin)).status).toBe(404);
    expect((await post(`/users/${id}/revoke-sessions`, admin)).status).toBe(404);
    const roles = await t.http().put(`/api/v1/users/${id}/locations/${s.demo.location.id}/roles`).set('Cookie', admin).send({ roles: ['staff'] });
    expect(roles.status).toBe(404);
    expect(await t.loginAs('bar-demo', 'duena')).toBeTruthy();
  });

  it('un dueño gestiona a otro dueño del mismo negocio; el superadmin también', async () => {
    const { id, root } = await makeOwner('duena');
    const second = await post('/users', root, { username: 'duena2', display_name: 'D2', password: PASSWORD, is_owner: true });
    const owner = await t.loginAs('bar-demo', 'duena');
    expect((await post(`/users/${second.body.id}/password-reset`, owner, { new_password: 'Nueva1234' })).status).toBe(204);
    expect((await post(`/users/${id}/revoke-sessions`, root)).status).toBe(204);
  });

  it('auto-desactivación y auto-reset rechazados (403); el dueño tampoco', async () => {
    const me = s.demo.userIds.admin!;
    expect((await post(`/users/${me}/deactivate`, admin)).status).toBe(403);
    expect((await post(`/users/${me}/password-reset`, admin, { new_password: 'Nueva1234' })).status).toBe(403);
    const roles = await t.http().put(`/api/v1/users/${me}/locations/${s.demo.location.id}/roles`).set('Cookie', admin).send({ roles: ['staff'] });
    expect(roles.status).toBe(403);
    await makeOwner('duena');
    const owner = await t.loginAs('bar-demo', 'duena');
    const ownerId = (await db.appUser.findFirstOrThrow({ where: { username: 'duena' } })).id;
    expect((await post(`/users/${ownerId}/deactivate`, owner)).status).toBe(403);
    expect((await t.http().get('/api/v1/me').set('Cookie', admin)).status).toBe(200);
  });
});

describe('alcance por local dentro del negocio (sin toma lateral entre locales)', () => {
  // Barra (local A, de `admin`) y Terraza (local B, de `adminb`); `ambos` es admin en las dos.
  async function twoLocations() {
    const actor: ActorContext = { ...s.root, actingOrganizationId: s.demo.organization.id };
    const terraza = await seedLocation(db, s.demo.organization, 'Terraza');
    const ids: Record<string, string> = {};
    for (const [username, locations] of [['adminb', [terraza.id]], ['ambos', [s.demo.location.id, terraza.id]]] as const) {
      const u = await t.get(CreateUser).execute({ actor, username, displayName: username, password: PASSWORD });
      ids[username] = u.id;
      for (const locationId of locations) await t.get(SetLocationRoles).execute({ actor, userId: u.id, locationId, roles: ['admin'] });
    }
    return { terraza, ids };
  }

  it('admin del local A contra admin del local B -> 404 en reset, desactivar, revocar y roles, sin cambios', async () => {
    const { terraza, ids } = await twoLocations();
    const b = ids.adminb!;
    expect((await post(`/users/${b}/password-reset`, admin, { new_password: 'Nueva1234' })).status).toBe(404);
    expect((await post(`/users/${b}/deactivate`, admin)).status).toBe(404);
    expect((await post(`/users/${b}/revoke-sessions`, admin)).status).toBe(404);
    const roles = await t.http().put(`/api/v1/users/${b}/locations/${s.demo.location.id}/roles`).set('Cookie', admin).send({ roles: ['staff'] });
    expect(roles.status).toBe(404);
    // Roles en un local donde no es admin: el guard lo rechaza.
    const foreign = await t.http().put(`/api/v1/users/${s.demo.userIds.mesero}/locations/${terraza.id}/roles`).set('Cookie', admin).send({ roles: ['staff'] });
    expect(foreign.status).toBe(403);
    expect((await db.appUser.findUniqueOrThrow({ where: { id: b } })).deactivatedAt).toBeNull();
    expect(await t.loginAs('bar-demo', 'adminb')).toBeTruthy();
    const list = await t.http().get('/api/v1/users').set('Cookie', admin);
    expect(list.body.users.map((u: { username: string }) => u.username)).toEqual(['admin', 'ambos', 'mesero']);
  });

  it('admin con membresía en ambos locales -> permitido', async () => {
    const { ids } = await twoLocations();
    const ambos = await t.loginAs('bar-demo', 'ambos');
    expect((await post(`/users/${ids.adminb}/password-reset`, ambos, { new_password: 'Nueva1234' })).status).toBe(204);
    expect((await post(`/users/${s.demo.userIds.mesero}/revoke-sessions`, ambos)).status).toBe(204);
  });

  it('el dueño gestiona a cualquiera del negocio', async () => {
    const { ids } = await twoLocations();
    const root = await t.loginAs('labs', 'root');
    await t.http().put('/api/v1/platform/acting-organization').set('Cookie', root).send({ organization_id: s.demo.organization.id });
    const created = await post('/users', root, { username: 'duena', display_name: 'Duena', password: PASSWORD, is_owner: true });
    expect(created.status).toBe(201);
    const owner = await t.loginAs('bar-demo', 'duena');
    expect((await post(`/users/${ids.adminb}/password-reset`, owner, { new_password: 'Nueva1234' })).status).toBe(204);
    expect((await post(`/users/${ids.adminb}/deactivate`, owner)).status).toBe(204);
  });
});
