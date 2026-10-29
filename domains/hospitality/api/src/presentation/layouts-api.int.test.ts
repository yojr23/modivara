import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { newId, permissionsFor, SESSION_COOKIE, type RequestActor } from '@modivara/core-contracts';
import {
  type LayoutElement, layoutConflictSchema, layoutDraftResponseSchema, layoutPublishedSchema, layoutSchema, REALTIME_EVENTS as E, REALTIME_PATH, tableSchema, zoneSchema,
} from '@modivara/hospitality-contracts';
import { createHospitalityTestApp, type TestCaller } from '../testing/http.js';
import { hospitalityPrismaForTests, resetHospitality, TEST_HOSPITALITY_DATABASE_URL } from '../testing/integration.js';

// Planos de espacios (ADR-003) por HTTP contra la base real: guard y filtro de prueba, repositorios Prisma.
let t: Awaited<ReturnType<typeof createHospitalityTestApp>>;
const db = hospitalityPrismaForTests();
const orgA = newId(), orgB = newId(), locA = newId(), locA2 = newId(), locB = newId();

const actor = (organizationId: string, over: Partial<RequestActor> = {}): RequestActor => ({
  actorUserId: newId(), organizationId, isPlatform: false, isOwner: false, sessionId: newId(), actingOrganizationId: null, ...over,
});
const perms = (role: 'admin' | 'staff' | 'inventory') => [...permissionsFor([role], { isOwner: false, isPlatform: false })];
const admin: TestCaller = { actor: actor(orgA), permissions: { [locA]: perms('admin'), [locA2]: perms('admin') }, modules: ['hospitality'] };
const staff: TestCaller = { actor: actor(orgA), permissions: { [locA]: perms('staff') }, modules: ['hospitality'] };
const inventory: TestCaller = { actor: actor(orgA), permissions: { [locA]: perms('inventory') }, modules: ['hospitality'] };
const adminB: TestCaller = { actor: actor(orgB), permissions: { [locB]: perms('admin') }, modules: ['hospitality'] };
const root: TestCaller = { actor: actor(newId(), { isPlatform: true, actingOrganizationId: orgA }), permissions: {}, modules: [] };

const base = `/locations/${locA}`;
const L = `${base}/layouts`;
const canvas = { canvas_width: 800, canvas_height: 600 };

beforeAll(async () => {
  t = await createHospitalityTestApp({ databaseUrl: TEST_HOSPITALITY_DATABASE_URL });
  await t.app.listen(0);
  for (const [id, organizationId] of [[locA, orgA], [locA2, orgA], [locB, orgB]] as const) t.core.add({ id, organizationId, timezone: 'America/Bogota', active: true });
});
beforeEach(() => resetHospitality(db));
afterAll(async () => {
  await t.app.close();
  await db.$disconnect();
});

const zone = async (name: string, loc = base) => zoneSchema.parse((await t.as(admin).post(`${loc}/zones`, { name })).body).id;
const table = async (label: string, zoneId: string | null = null, loc = base) =>
  tableSchema.parse((await t.as(admin).post(`${loc}/tables`, { label, zone_id: zoneId })).body).id;
const tableEl = (tableId: string, over: Record<string, unknown> = {}): LayoutElement =>
  ({ id: newId(), type: 'table', table_id: tableId, shape: 'round', x: 100, y: 100, width: 40, height: 40, rotation: 0, ...over }) as LayoutElement;
const bar = (): LayoutElement => ({ id: newId(), type: 'bar', x: 10, y: 10, width: 200, height: 30, rotation: 0 });
const save = (elements: LayoutElement[], revision = 0, zone_id: string | null = null, who = admin) =>
  t.as(who).put(`${L}/draft`, { zone_id, revision, ...canvas, elements });
const publish = (revision: number, zone_id: string | null = null, who = admin) => t.as(who).post(`${L}/publish`, { zone_id, revision });
const published = async (who = staff) => layoutSchema.array().parse((await t.as(who).get(L)).body);

describe('permisos y aislamiento', () => {
  it('staff lee los publicados pero no toca el borrador ni publica; inventory no lee', async () => {
    expect((await t.as(staff).get(L)).status).toBe(200);
    expect((await t.as(staff).get(`${L}/draft`)).status).toBe(403);
    expect((await save([])).status).toBe(200);
    expect((await save([], 1, null, staff)).status).toBe(403);
    expect((await publish(1, null, staff)).status).toBe(403);
    expect((await t.as(inventory).get(L)).status).toBe(403);
    expect((await t.as(inventory).get(`${L}/draft`)).status).toBe(403);
  });

  it('otro negocio o local sin permiso: 404; el cuerpo no cambia el tenant', async () => {
    expect((await t.as(adminB).get(L)).status).toBe(404);
    expect((await t.as(adminB).put(`${L}/draft`, { zone_id: null, revision: 0, ...canvas, elements: [] })).status).toBe(404);
    expect((await t.as(staff).get(`/locations/${locA2}/layouts`)).status).toBe(404);
    await t.as(admin).put(`${L}/draft`, { zone_id: null, revision: 0, ...canvas, elements: [], organization_id: orgB, location_id: locB });
    expect(await db.spaceLayout.findFirstOrThrow()).toMatchObject({ organizationId: orgA, locationId: locA });
  });

  it('zona de otro local o inexistente: 404', async () => {
    const foreign = await zone('Otra', `/locations/${locA2}`);
    expect((await save([], 0, foreign)).status).toBe(404);
    expect((await save([], 0, newId())).status).toBe(404);
    expect((await t.as(admin).get(`${L}/draft?zone_id=${foreign}`)).status).toBe(404);
  });
});

describe('borrador', () => {
  it('crear (revisión 0), leer, y cada guardado sube la revisión', async () => {
    const m = await table('1');
    expect(layoutDraftResponseSchema.parse((await t.as(admin).get(`${L}/draft`)).body)).toEqual({ draft: null, published: null });
    const first = await save([tableEl(m), bar()]);
    expect(first.status).toBe(200);
    expect(layoutSchema.parse(first.body)).toMatchObject({ zone_id: null, version: 0, status: 'draft', revision: 1, published_at: null, ...canvas });
    expect(layoutSchema.parse((await save([tableEl(m)], 1)).body).revision).toBe(2);
    const got = layoutDraftResponseSchema.parse((await t.as(admin).get(`${L}/draft`)).body);
    expect(got.draft).toMatchObject({ revision: 2, elements: [{ table_id: m }] });
    expect(await db.spaceLayout.findFirstOrThrow()).toMatchObject({ createdBy: admin.actor.actorUserId, updatedBy: admin.actor.actorUserId });
  });

  it('revisión obsoleta: 409 con el borrador vigente (al crear y al guardar)', async () => {
    await save([]);
    const create = await save([], 0);
    expect(create.status).toBe(409);
    expect(layoutConflictSchema.parse(create.body)).toMatchObject({ code: 'revision_conflict', current: { revision: 1 } });
    await save([], 1);
    const stale = await save([bar()], 1);
    expect(stale.status).toBe(409);
    expect(layoutConflictSchema.parse(stale.body).current?.revision).toBe(2);
    expect((await save([], 7)).status).toBe(409);
    expect(await db.spaceLayout.count()).toBe(1);
  });

  it('mesa de otra zona, de otro local, desactivada o repetida: 400, y no se guarda nada', async () => {
    const terraza = await zone('Terraza');
    const inZone = await table('1', terraza);
    const noZone = await table('2');
    const foreign = await table('3', null, `/locations/${locA2}`);
    const gone = await table('4');
    expect((await t.as(admin).post(`${base}/tables/${gone}/deactivate`)).status).toBe(204);
    expect((await save([tableEl(inZone)])).status).toBe(400); // espacio por defecto, mesa de Terraza
    expect((await save([tableEl(noZone)], 0, terraza)).status).toBe(400); // Terraza, mesa sin zona
    expect((await save([tableEl(foreign)])).status).toBe(400);
    expect((await save([tableEl(gone)])).status).toBe(400);
    expect((await save([tableEl(newId())])).status).toBe(400);
    expect((await save([tableEl(noZone), tableEl(noZone, { x: 5 })])).status).toBe(400); // duplicada
    expect(await db.spaceLayout.count()).toBe(0);
    expect((await save([tableEl(inZone)], 0, terraza)).status).toBe(200);
  });

  it('geometría inválida: 400', async () => {
    const m = await table('1');
    for (const bad of [{ rotation: 360 }, { width: 0 }, { x: 801 }, { shape: 'oval' }]) expect((await save([tableEl(m, bad)])).status).toBe(400);
    expect((await save(Array.from({ length: 501 }, bar))).status).toBe(400);
    expect((await t.as(admin).put(`${L}/draft`, { zone_id: null, revision: 0, canvas_width: 0, canvas_height: 5, elements: [] })).status).toBe(400);
  });
});

describe('publicación', () => {
  it('publica, archiva el anterior y la versión sube; un solo publicado por espacio', async () => {
    const m = await table('1');
    await save([tableEl(m)]);
    expect((await publish(9)).status).toBe(409); // revisión equivocada
    const v1 = await publish(1);
    expect(v1.status).toBe(200);
    expect(layoutSchema.parse(v1.body)).toMatchObject({ status: 'published', version: 1, zone_id: null });
    expect(layoutDraftResponseSchema.parse((await t.as(admin).get(`${L}/draft`)).body)).toMatchObject({ draft: null, published: { version: 1 } });
    expect((await publish(1)).status).toBe(409); // ya no hay borrador

    await save([tableEl(m, { x: 300 })]);
    expect(layoutSchema.parse((await publish(1)).body).version).toBe(2);
    const rows = await db.spaceLayout.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.status])).toEqual([[1, 'archived'], [2, 'published']]);
    expect(await published()).toMatchObject([{ version: 2, elements: [{ x: 300 }] }]);
  });

  it('staff sigue viendo lo publicado mientras el borrador cambia', async () => {
    const m = await table('1');
    await save([tableEl(m)]);
    await publish(1);
    await save([tableEl(m, { x: 700 })]);
    expect(await published()).toMatchObject([{ version: 1, elements: [{ x: 100 }] }]);
  });

  it('dos publicaciones simultáneas de la misma revisión: una gana y la otra recibe 409', async () => {
    const m = await table('1');
    await save([tableEl(m)]);
    const results = await Promise.all([publish(1), publish(1), publish(1)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await db.spaceLayout.count({ where: { status: 'published' } })).toBe(1);
    expect(await db.spaceLayout.count()).toBe(1);
  });

  it('guardar y publicar a la vez: nunca se pierde un guardado en silencio', async () => {
    await save([bar()]);
    const [saved, pub] = await Promise.all([save([bar(), bar()], 1), publish(1)]);
    expect(pub.status).toBe(200);
    // Si el guardado ganó, la publicación habría visto otra revisión (409); si perdió, recibe 409 por no haber borrador.
    expect([200, 409]).toContain(saved.status);
    if (saved.status === 200) expect((await published())[0]?.elements).toHaveLength(2);
  });

  it('espacios por zona son independientes y el espacio por defecto convive con ellos', async () => {
    const terraza = await zone('Terraza');
    const a = await table('1', terraza);
    const b = await table('1');
    await save([tableEl(a)], 0, terraza);
    await save([tableEl(b)]);
    await publish(1, terraza);
    await publish(1);
    expect((await published()).map((l) => [l.zone_id, l.version])).toEqual([[null, 1], [terraza, 1]]);
  });

  it('publicar revalida las mesas: una mesa movida de zona tras guardar hace fallar la publicación (400)', async () => {
    const terraza = await zone('Terraza');
    const m = await table('1');
    await save([tableEl(m)]);
    expect((await t.as(admin).patch(`${base}/tables/${m}`, { zone_id: terraza })).status).toBe(200);
    expect((await publish(1)).status).toBe(400);
    expect(await db.spaceLayout.findFirstOrThrow()).toMatchObject({ status: 'draft' });
  });

  it('superadmin actuando sobre un negocio publica y queda como autor', async () => {
    const m = await table('1');
    expect((await save([tableEl(m)], 0, null, root)).status).toBe(200);
    expect((await publish(1, null, root)).status).toBe(200);
    expect(await db.spaceLayout.findFirstOrThrow()).toMatchObject({
      organizationId: orgA, createdBy: root.actor.actorUserId, updatedBy: root.actor.actorUserId, publishedBy: root.actor.actorUserId,
    });
  });
});

describe('lectura de publicados', () => {
  it('una mesa movida de zona por PATCH, o desactivada, desaparece del plano publicado (queda sin ubicar)', async () => {
    const terraza = await zone('Terraza');
    const m1 = await table('1');
    const m2 = await table('2');
    const m3 = await table('3');
    await save([tableEl(m1), tableEl(m2), tableEl(m3), bar()]);
    await publish(1);
    expect((await published())[0]?.elements).toHaveLength(4);
    await t.as(admin).patch(`${base}/tables/${m1}`, { zone_id: terraza });
    await t.as(admin).post(`${base}/tables/${m2}/deactivate`);
    const [layout] = await published();
    expect(layout?.elements.map((e) => (e.type === 'table' ? e.table_id : e.type))).toEqual([m3, 'bar']);
    // El borrador no se filtra: el editor ve lo que hay.
    expect((await db.spaceLayout.findMany()).length).toBe(1);
  });

  it('el plano de una zona desactivada se omite', async () => {
    const terraza = await zone('Terraza');
    const m = await table('1', terraza);
    await save([tableEl(m)], 0, terraza);
    await publish(1, terraza);
    expect(await published()).toHaveLength(1);
    await t.as(admin).post(`${base}/tables/${m}/deactivate`);
    await t.as(admin).post(`${base}/zones/${terraza}/deactivate`);
    expect(await published()).toEqual([]);
    expect((await t.as(admin).get(`${L}/draft?zone_id=${terraza}`)).status).toBe(404);
  });

  it('otro local no ve los planos de este', async () => {
    await save([bar()]);
    await publish(1);
    expect(await t.as(adminB).get(L)).toMatchObject({ status: 404 });
    expect(await published(admin)).toHaveLength(1);
    expect((await t.as(admin).get(`/locations/${locA2}/layouts`)).body).toEqual([]);
  });
});

describe('tiempo real', () => {
  const open: Socket[] = [];
  afterEach(() => { for (const s of open.splice(0)) s.disconnect(); });
  const url = () => `http://127.0.0.1:${(t.app.getHttpServer().address() as { port: number }).port}`;
  const join = async (token: string, caller: TestCaller) => {
    t.core.addSession(token, caller.actor);
    const socket = io(url(), { path: REALTIME_PATH, transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: { cookie: `${SESSION_COOKIE}=${token}` } });
    open.push(socket);
    await new Promise<void>((res, rej) => { socket.on('connect', res); socket.on('connect_error', rej); });
    const ack = await new Promise<{ ok: boolean }>((res) => socket.emit(E.subscribe, { location_id: locA }, res));
    return { socket, ack };
  };

  it('al publicar se emite layout.published a la sala del local (solo a quien lee llamados)', async () => {
    t.core.grant(staff.actor.actorUserId, locA, staff.permissions[locA]!);
    const { socket, ack } = await join('tok-staff', staff);
    expect(ack.ok).toBe(true);
    const event = new Promise<unknown>((res, rej) => { const timer = setTimeout(() => rej(new Error('sin layout.published')), 2000); socket.once(E.layoutPublished, (p) => { clearTimeout(timer); res(p); }); });
    await save([bar()]);
    await publish(1);
    expect(layoutPublishedSchema.parse(await event)).toEqual({ location_id: locA, zone_id: null, version: 1 });
  });

  it('guardar un borrador no emite nada', async () => {
    t.core.grant(staff.actor.actorUserId, locA, staff.permissions[locA]!);
    const { socket } = await join('tok-staff-2', staff);
    let got = false;
    socket.on(E.layoutPublished, () => { got = true; });
    await save([bar()]);
    await new Promise((r) => setTimeout(r, 250));
    expect(got).toBe(false);
  });
});
