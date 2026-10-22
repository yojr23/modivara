import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { newId, permissionsFor, SESSION_COOKIE, type RequestActor } from '@modivara/core-contracts';
import { gatewaysStatusSchema, REALTIME_EVENTS as E, REALTIME_PATH, realtimeSubscribeAckSchema, serviceCallSchema } from '@modivara/hospitality-contracts';
import { DiningTable } from '../../domain/tables/dining-table.js';
import { ServiceCall } from '../../domain/service-calls/service-call.js';
import { createHospitalityTestApp, type TestCaller } from '../../testing/http.js';
import { GATEWAY_HEALTH_NOTIFIER } from '../../hospitality.module.js';
import type { GatewayHealthNotifier } from '../../application/ports/index.js';

let t: Awaited<ReturnType<typeof createHospitalityTestApp>>;
let url: string;
const orgA = newId(), orgB = newId(), locA = newId(), locB = newId();
const actor = (organizationId: string): RequestActor => ({
  actorUserId: newId(), organizationId, isPlatform: false, isOwner: false, sessionId: newId(), actingOrganizationId: null,
});
const perms = (role: 'admin' | 'staff' | 'inventory') => [...permissionsFor([role], { isOwner: false, isPlatform: false })];
const mk = (org: string, loc: string, role: 'admin' | 'staff' | 'inventory', token: string): TestCaller => {
  const c: TestCaller = { actor: actor(org), permissions: { [loc]: perms(role) }, modules: ['hospitality'] };
  t.core.addSession(token, c.actor);
  t.core.grant(c.actor.actorUserId, loc, c.permissions[loc]!);
  return c;
};

const open: Socket[] = [];
const connect = (opts: { token?: string; origin?: string } = {}): Socket => {
  const socket = io(url, {
    path: REALTIME_PATH, transports: ['websocket'], reconnection: false, forceNew: true,
    extraHeaders: { ...(opts.token && { cookie: `${SESSION_COOKIE}=${opts.token}` }), ...(opts.origin && { origin: opts.origin }) },
  });
  open.push(socket);
  return socket;
};
const connected = (s: Socket) => new Promise<void>((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
const subscribe = (s: Socket, location_id: string) => new Promise<unknown>((res) => s.emit(E.subscribe, { location_id }, res));
const next = <T>(s: Socket, event: string, ms = 1500) =>
  new Promise<T>((res, rej) => { const timer = setTimeout(() => rej(new Error(`sin ${event}`)), ms); s.once(event, (p: T) => { clearTimeout(timer); res(p); }); });
const silent = async (s: Socket, event: string) => {
  let got = false;
  s.on(event, () => { got = true; });
  await new Promise((r) => setTimeout(r, 250));
  return !got;
};

beforeAll(async () => {
  t = await createHospitalityTestApp();
  await t.app.listen(0);
  url = `http://127.0.0.1:${(t.app.getHttpServer().address() as { port: number }).port}`;
  t.core.add({ id: locA, organizationId: orgA, timezone: 'America/Bogota', active: true });
  t.core.add({ id: locB, organizationId: orgB, timezone: 'America/Bogota', active: true });
});
afterEach(() => { for (const s of open.splice(0)) s.disconnect(); });
afterAll(() => t.app.close());

describe('F3-10 Socket.IO (handshake y suscripción)', () => {
  it('rechaza sin cookie, con sesión inválida y con Origin distinto del host', async () => {
    await expect(connected(connect())).rejects.toThrow('unauthorized');
    await expect(connected(connect({ token: 'inventada' }))).rejects.toThrow('unauthorized');
    mk(orgA, locA, 'staff', 'tok-ok');
    await expect(connected(connect({ token: 'tok-ok', origin: 'https://malo.example' }))).rejects.toThrow('forbidden_origin');
    await connected(connect({ token: 'tok-ok', origin: url })); // mismo host: pasa
  });

  it('suscripción: con permiso en el local ok; local ajeno o sin calls.read -> ok:false', async () => {
    mk(orgA, locA, 'staff', 'staff-a');
    mk(orgA, locA, 'inventory', 'inv-a');
    const s = connect({ token: 'staff-a' });
    await connected(s);
    expect(realtimeSubscribeAckSchema.parse(await subscribe(s, locA))).toEqual({ ok: true });
    expect(await subscribe(s, locB)).toEqual({ ok: false, code: 'not_found' });
    expect(await subscribe(s, 'no-uuid')).toEqual({ ok: false, code: 'validation' });
    const inv = connect({ token: 'inv-a' });
    await connected(inv);
    expect(await subscribe(inv, locA)).toEqual({ ok: false, code: 'permission_denied' });
  });
});

describe('F3-10 emisión', () => {
  const seed = async (organizationId: string, locationId: string, label: string) => {
    const table = DiningTable.create({ organizationId, locationId, label, createdBy: newId(), now: new Date() });
    await t.repos.tables.save(table);
    const call = ServiceCall.create({
      organizationId, locationId, table: { id: table.id, label, zoneId: null, zoneName: null }, callType: 'attention', deviceEventId: newId(), correlationId: newId(), now: new Date(),
    });
    await t.repos.calls.save(call);
    return call;
  };

  it('service_call.changed solo a la sala del local y filtrado por canSeeCall', async () => {
    const a = mk(orgA, locA, 'staff', 'a1');
    mk(orgB, locB, 'staff', 'b1');
    const sa = connect({ token: 'a1' }), sb = connect({ token: 'b1' });
    await Promise.all([connected(sa), connected(sb)]);
    await subscribe(sa, locA);
    await subscribe(sb, locB);
    const call = await seed(orgA, locA, '9');
    const gotA = next<unknown>(sa, E.serviceCallChanged);
    const silentB = silent(sb, E.serviceCallChanged);
    const res = await t.as(a).post(`/locations/${locA}/service-calls/${call.id}/acknowledge`);
    expect(res.status).toBe(200);
    expect(serviceCallSchema.parse(await gotA)).toMatchObject({ id: call.id, location_id: locA, status: 'in_progress', table_display_name: '9' });
    expect(await silentB).toBe(true);
  });

  it('un usuario sin sesión vigente deja de recibir y su socket se cierra', async () => {
    const a = mk(orgA, locA, 'staff', 'a2');
    const s = connect({ token: 'a2' });
    await connected(s);
    await subscribe(s, locA);
    const call = await seed(orgA, locA, '10');
    const closed = new Promise<string>((res) => s.once('disconnect', res));
    (t.core as unknown as { sessions: Map<string, unknown> }).sessions.delete('a2'); // logout
    await t.as(a).post(`/locations/${locA}/service-calls/${call.id}/acknowledge`);
    expect(await closed).toBe('io server disconnect');
  });

  it('gateways.status a la sala del local en cada transición', async () => {
    mk(orgA, locA, 'staff', 'a3');
    const s = connect({ token: 'a3' });
    await connected(s);
    await subscribe(s, locA);
    const notifier = t.app.get<GatewayHealthNotifier>(GATEWAY_HEALTH_NOTIFIER);
    const down = next<unknown>(s, E.gatewaysStatus);
    await notifier.connectivityChanged({ organizationId: orgA, locationId: locA, connected: false, disconnectedGatewayIds: [newId()] });
    expect(gatewaysStatusSchema.parse(await down)).toEqual({ location_id: locA, connectivity: 'some_disconnected' });
    const up = next<unknown>(s, E.gatewaysStatus);
    await notifier.connectivityChanged({ organizationId: orgA, locationId: locA, connected: true, disconnectedGatewayIds: [] });
    expect(gatewaysStatusSchema.parse(await up)).toEqual({ location_id: locA, connectivity: 'all_connected' });
    await notifier.connectivityChanged({ organizationId: orgB, locationId: locB, connected: false, disconnectedGatewayIds: [] }); // otro local: sin sala, sin efecto
  });
});
