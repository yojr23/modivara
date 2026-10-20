import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, meResponseSchema } from '@modivara/core-contracts';
import { corePrismaForTests, resetCore } from '../testing/integration.js';
import { createTestApp, PASSWORD, seedScenario, type TestApp } from '../testing/http.js';

// F1-10: el superadmin opera sobre un negocio solo tras elegirlo; todo queda auditado con su usuario.
const db = corePrismaForTests();
let t: TestApp;
let s: Awaited<ReturnType<typeof seedScenario>>;
let root: string;

beforeAll(async () => {
  t = await createTestApp();
});
beforeEach(async () => {
  await resetCore(db);
  s = await seedScenario(t.get);
  root = await t.loginAs('labs', 'root');
});
afterAll(async () => {
  await t.app.close();
  await db.$disconnect();
});

const actAs = (cookie: string, organizationId: string | null) =>
  t.http().put('/api/v1/platform/acting-organization').set('Cookie', cookie).send({ organization_id: organizationId });
const usernames = async (cookie: string) =>
  ((await t.http().get('/api/v1/users').set('Cookie', cookie)).body.users as Array<{ username: string }>).map((u) => u.username);

describe('superadmin: operar sobre el negocio X', () => {
  it('sin acting_organization_id no accede a datos de ningún negocio', async () => {
    const me = meResponseSchema.parse((await t.http().get('/api/v1/me').set('Cookie', root)).body);
    expect(me.actor.is_platform).toBe(true);
    expect(me).toMatchObject({ organization: null, modules: [], locations: [] });
    expect(await usernames(root)).toEqual(['root']);
    const bUser = s.demo.userIds.mesero;
    expect((await t.http().post(`/api/v1/users/${bUser}/deactivate`).set('Cookie', root)).status).toBe(404);
  });

  it('con acting_organization_id accede a los datos de ese negocio y de ningún otro', async () => {
    const res = await actAs(root, s.demo.organization.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acting_organization_id: s.demo.organization.id });
    expect(await usernames(root)).toEqual(['admin', 'mesero']);
    const me = meResponseSchema.parse((await t.http().get('/api/v1/me').set('Cookie', root)).body);
    expect(me.organization).toMatchObject({ slug: 'bar-demo' });
    expect(me.actor.acting_organization_id).toBe(s.demo.organization.id);
    expect(me.locations.map((l) => l.id)).toEqual([s.demo.location.id]);

    await actAs(root, s.pisos.organization.id);
    expect(await usernames(root)).toEqual(['adminp', 'meserop']);
    await actAs(root, null);
    expect(await usernames(root)).toEqual(['root']);
  });

  it('una acción con acting_organization_id queda auditada con el usuario del superadmin', async () => {
    await actAs(root, s.demo.organization.id);
    const created = await t.http().post('/api/v1/users').set('Cookie', root).send({ username: 'nuevo', display_name: 'Nuevo', password: PASSWORD });
    expect(created.status).toBe(201);
    const rootId = (await db.appUser.findFirstOrThrow({ where: { username: 'root' } })).id;
    const entries = await db.auditLog.findMany({ where: { actorUserId: rootId, organizationId: s.demo.organization.id }, orderBy: { occurredAt: 'asc' } });
    expect(entries.map((e) => e.action)).toContain('session.acting_organization_selected');
    expect(entries.map((e) => e.action)).toContain('user.created');
    expect((await db.appUser.findFirstOrThrow({ where: { username: 'nuevo' } })).organizationId).toBe(s.demo.organization.id);
  });

  it('un admin de negocio no puede elegir negocio (403); un negocio inexistente -> 404', async () => {
    const admin = await t.loginAs('bar-demo', 'admin');
    expect((await actAs(admin, s.pisos.organization.id)).status).toBe(403);
    expect((await actAs(root, newId())).status).toBe(404);
    expect((await actAs(root, 'no-uuid')).status).toBe(400);
  });

  it('desactivar el negocio elegido devuelve al superadmin a su propia organización', async () => {
    await actAs(root, s.demo.organization.id);
    await db.organization.update({ where: { id: s.demo.organization.id }, data: { deactivatedAt: new Date() } });
    expect(await usernames(root)).toEqual(['root']);
  });
});
