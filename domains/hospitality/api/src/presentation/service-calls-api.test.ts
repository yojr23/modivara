import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, permissionsFor, type Permission, type RequestActor } from '@modivara/core-contracts';
import { type CallType, callConflictSchema, serviceCallPageSchema, serviceCallSchema, tableSchema, zoneSchema } from '@modivara/hospitality-contracts';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import { createHospitalityTestApp, type TestCaller } from '../testing/http.js';

let t: Awaited<ReturnType<typeof createHospitalityTestApp>>;
const orgA = newId(), orgB = newId(), locA = newId(), locA2 = newId(), locB = newId();
const actor = (organizationId: string): RequestActor => ({
  actorUserId: newId(), organizationId, isPlatform: false, isOwner: false, sessionId: newId(), actingOrganizationId: null,
});
const perms = (role: 'admin' | 'staff' | 'inventory'): Permission[] => [...permissionsFor([role], { isOwner: false, isPlatform: false })];
const caller = (organizationId: string, locationId: string, role: 'admin' | 'staff' | 'inventory'): TestCaller => ({
  actor: actor(organizationId), permissions: { [locationId]: perms(role) }, modules: ['hospitality'],
});
const staff = caller(orgA, locA, 'staff');
const staff2 = caller(orgA, locA, 'staff');
const inventory = caller(orgA, locA, 'inventory');
const staffB = caller(orgB, locB, 'staff');
const base = `/locations/${locA}`;

let tableId: string;
let tableB: string;
/** Llamado de prueba creado `ago` ms antes de una base fija, directo en el repositorio. */
let labels = 0;
const freshTable = async (organizationId: string, locationId: string) =>
  tableSchema.parse((await t.as(caller(organizationId, locationId, 'admin')).post(`/locations/${locationId}/tables`, { label: `m${++labels}` })).body).id;
/** Un llamado activo por mesa y tipo (solo hay `attention`): cada llamado de prueba usa su mesa, salvo que se indique. */
const seedCall = async (organizationId: string, locationId: string, table: string | null, at: Date, callType: CallType = 'attention') => {
  const call = ServiceCall.create({
    organizationId, locationId, table: { id: table ?? (await freshTable(organizationId, locationId)), label: '1', zoneId: null, zoneName: null }, callType,
    deviceEventId: newId(), correlationId: newId(), now: at,
  });
  await t.repos.calls.save(call);
  return call.id;
};

beforeAll(async () => {
  t = await createHospitalityTestApp();
  for (const [id, organizationId] of [[locA, orgA], [locA2, orgA], [locB, orgB]] as const) t.core.add({ id, organizationId, timezone: 'America/Bogota', active: true });
  const admin = caller(orgA, locA, 'admin');
  const zone = zoneSchema.parse((await t.as(admin).post(`${base}/zones`, { name: 'Terraza' })).body);
  tableId = tableSchema.parse((await t.as(admin).post(`${base}/tables`, { label: '3', zone_id: zone.id })).body).id;
  const adminB = caller(orgB, locB, 'admin');
  tableB = tableSchema.parse((await t.as(adminB).post(`/locations/${locB}/tables`, { label: '1' })).body).id;
});
afterAll(() => t.app.close());

describe('F3-08 GET service-calls', () => {
  it('inventory 403; sin sesión 401; local ajeno 404', async () => {
    expect((await t.as(inventory).get(`${base}/service-calls`)).status).toBe(403);
    expect((await t.as(staffB).get(`${base}/service-calls`)).status).toBe(404);
    expect((await t.as({ ...staff, modules: [] }).get(`${base}/service-calls`)).status).toBe(403);
  });

  it('staff ve todos los activos del local (más antiguos primero), nunca los de otro local', async () => {
    const a = await seedCall(orgA, locA, tableId, new Date('2026-10-19T10:00:00Z'));
    const b = await seedCall(orgA, locA, null, new Date('2026-10-19T10:01:00Z'));
    await seedCall(orgB, locB, tableB, new Date('2026-10-19T10:00:30Z'));
    const res = await t.as(staff).get(`${base}/service-calls?status=active`);
    expect(res.status).toBe(200);
    const page = serviceCallPageSchema.parse(res.body);
    expect(page.items.map((c) => c.id)).toEqual([a, b]);
    expect(page.items[0]).toMatchObject({ location_id: locA, table_display_name: 'Terraza · 3', status: 'pending' });
    expect(page.next_cursor).toBeNull();
  });

  it('historial con filtros y cursor estable (más recientes primero, sin repetir ni saltar)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await seedCall(orgA, locA, null, new Date(Date.UTC(2026, 9, 18, 10, i))));
    const q = '?status=all&from=2026-10-18T00:00:00Z&to=2026-10-19T00:00:00Z&limit=2';
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 5; guard++) {
      const page = serviceCallPageSchema.parse((await t.as(staff).get(`${base}/service-calls${q}${cursor ? `&cursor=${cursor}` : ''}`)).body);
      seen.push(...page.items.map((c) => c.id));
      if (!(cursor = page.next_cursor)) break;
    }
    expect(seen).toEqual([...ids].reverse());
    expect((await t.as(staff).get(`${base}/service-calls?status=all&table_id=${newId()}`)).body.items).toEqual([]);
    expect((await t.as(staff).get(`${base}/service-calls?cursor=basura`)).status).toBe(400);
    expect((await t.as(staff).get(`${base}/service-calls?status=nope`)).status).toBe(400);
  });
});

describe('F3-08 acknowledge / complete', () => {
  it('inventory 403; local ajeno y llamado ajeno 404', async () => {
    const id = await seedCall(orgA, locA, null, new Date('2026-10-17T10:00:00Z'));
    expect((await t.as(inventory).post(`${base}/service-calls/${id}/acknowledge`)).status).toBe(403);
    expect((await t.as(staffB).post(`${base}/service-calls/${id}/acknowledge`)).status).toBe(404);
    expect((await t.as(staffB).post(`/locations/${locB}/service-calls/${id}/acknowledge`)).status).toBe(404);
    expect((await t.as(staff).post(`${base}/service-calls/${newId()}/acknowledge`)).status).toBe(404);
    expect((await t.as(staff).post(`${base}/service-calls/no-uuid/acknowledge`)).status).toBe(400);
  });

  it('reconocer y finalizar devuelven el llamado actualizado; reconocido por otro -> 409 con el estado actual', async () => {
    const id = await seedCall(orgA, locA, null, new Date('2026-10-17T11:00:00Z'));
    const ack = await t.as(staff).post(`${base}/service-calls/${id}/acknowledge`);
    expect(ack.status).toBe(200);
    expect(serviceCallSchema.parse(ack.body)).toMatchObject({ id, status: 'in_progress', acknowledged_by: staff.actor.actorUserId });

    const conflict = await t.as(staff2).post(`${base}/service-calls/${id}/acknowledge`);
    expect(conflict.status).toBe(409);
    const body = callConflictSchema.parse(conflict.body);
    expect(body.current).toMatchObject({ id, status: 'in_progress', acknowledged_by: staff.actor.actorUserId, table_display_name: expect.any(String) });

    // Finalizar un pendiente (aún sin reconocer) también es conflicto con el estado vigente.
    const other = await seedCall(orgA, locA, null, new Date('2026-10-17T11:05:00Z'));
    const bad = await t.as(staff).post(`${base}/service-calls/${other}/complete`);
    expect(bad.status).toBe(409);
    expect(callConflictSchema.parse(bad.body).current.status).toBe('pending');

    const done = await t.as(staff2).post(`${base}/service-calls/${id}/complete`);
    expect(serviceCallSchema.parse(done.body)).toMatchObject({ status: 'completed', completed_by: staff2.actor.actorUserId });
  });

  it('repetir la misma acción (con Idempotency-Key) devuelve el mismo resultado sin nueva transición', async () => {
    const id = await seedCall(orgA, locA, null, new Date('2026-10-17T12:00:00Z'));
    const key = { 'Idempotency-Key': newId() };
    const first = await t.as(staff).post(`${base}/service-calls/${id}/acknowledge`, undefined, key);
    const again = await t.as(staff).post(`${base}/service-calls/${id}/acknowledge`, undefined, key);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const done = await t.as(staff).post(`${base}/service-calls/${id}/complete`, undefined, key);
    const doneAgain = await t.as(staff).post(`${base}/service-calls/${id}/complete`, undefined, key);
    expect(doneAgain.status).toBe(200);
    expect(doneAgain.body).toEqual(done.body);
    expect(t.repos.calls.transitions.filter((x) => x.serviceCallId === id).map((x) => x.action)).toEqual(['create', 'acknowledge', 'complete']);
  });
});
