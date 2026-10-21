import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RESERVED_SLUGS, ValidationError } from '@modivara/core-contracts';
import { ProvisionOrganization } from '../application/index.js';
import { corePrismaForTests, resetCore } from '../testing/integration.js';
import { createTestApp, PASSWORD, seedScenario, type TestApp } from '../testing/http.js';

// F1-12, la «prueba de fuego» de la fase: bar-demo (A) no obtiene nada de bar-demo-pisos (B) por ningún endpoint de F1.
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

describe('usuarios de bar-demo contra bar-demo-pisos', () => {
  it.each(['admin', 'mesero'])('%s: ni datos ni acciones sobre B por ningún endpoint', async (who) => {
    const cookie = await t.loginAs('bar-demo', who);
    const b = { user: s.pisos.userIds.meserop!, location: s.pisos.location.id };
    const call = (method: 'get' | 'post' | 'put', path: string, body?: object) =>
      t.http()[method](`/api/v1${path}`).set('Cookie', cookie).send(body);

    // /me solo expone el negocio propio.
    const me = await call('get', '/me');
    expect(JSON.stringify(me.body)).not.toContain(s.pisos.organization.id);
    expect(JSON.stringify(me.body)).not.toContain(b.location);

    // Listado: ningún usuario de B (el staff ni siquiera lista).
    const list = await call('get', '/users');
    expect(JSON.stringify(list.body)).not.toContain('meserop');
    expect(JSON.stringify(list.body)).not.toContain('adminp');

    // Escrituras sobre B: nunca 2xx, y B queda intacta.
    const attempts = [
      await call('post', `/users/${b.user}/password-reset`, { new_password: 'Nueva1234' }),
      await call('post', `/users/${b.user}/deactivate`),
      await call('post', `/users/${b.user}/revoke-sessions`),
      await call('put', `/users/${b.user}/locations/${b.location}/roles`, { roles: ['admin'] }),
      await call('put', `/users/${s.demo.userIds.mesero}/locations/${b.location}/roles`, { roles: ['admin'] }),
      await call('put', '/platform/acting-organization', { organization_id: s.pisos.organization.id }),
    ];
    for (const r of attempts) expect([403, 404]).toContain(r.status);
    expect((await db.appUser.findUniqueOrThrow({ where: { id: b.user } })).deactivatedAt).toBeNull();
    expect(await db.locationMembership.count({ where: { locationId: b.location, roles: { has: 'admin' } } })).toBe(1);

    // Rutas por local de otros dominios: el local ajeno es indistinguible de uno inexistente.
    expect((await call('get', `/probe/locations/${b.location}/calls`)).status).toBe(404);
    // Y el módulo que B contrata y A no (commerce) no se filtra.
    expect((await call('get', '/probe/stock')).status).toBe(403);
  });

  it('las credenciales de A no sirven en B', async () => {
    for (const [slug, username] of [['bar-demo-pisos', 'admin'], ['bar-demo', 'adminp']] as const) {
      const res = await t.http().post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
      expect(res.status).toBe(401);
    }
  });

  it('un token de A no se convierte en acceso a B aunque se mande el id de B en la ruta', async () => {
    const cookie = await t.loginAs('bar-demo', 'admin');
    const res = await t.http().get(`/api/v1/probe/locations/${s.pisos.location.id}/calls`).set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect((await t.http().get(`/api/v1/probe/locations/${s.demo.location.id}/calls`).set('Cookie', cookie)).status).toBe(200);
  });
});

describe('slugs reservados', () => {
  it.each(RESERVED_SLUGS)('"%s" no se asigna a un negocio cliente', async (slug) => {
    const provision = t.get(ProvisionOrganization);
    await expect(provision.execute({ actor: s.root, slug, name: 'X', locations: [], modules: [] })).rejects.toThrow(ValidationError);
    expect(await db.organization.count({ where: { slug, isPlatform: false } })).toBe(0);
  });
});
