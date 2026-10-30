import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, permissionsFor, type RequestActor } from '@modivara/core-contracts';
import {
  deviceSchema, deviceStatusSchema, gatewayCreatedSchema, gatewaySchema, tableSchema, unknownDeviceSchema, zoneSchema,
} from '@modivara/hospitality-contracts';
import { DeviceEvent } from '../domain/devices/device-event.js';
import { createHospitalityTestApp, type TestCaller } from '../testing/http.js';

type T = Awaited<ReturnType<typeof createHospitalityTestApp>>;
let t: T;
const orgA = newId(), orgB = newId(), locA1 = newId(), locA2 = newId(), locB = newId();

const actor = (organizationId: string, over: Partial<RequestActor> = {}): RequestActor => ({
  actorUserId: newId(), organizationId, isPlatform: false, isOwner: false, sessionId: newId(), actingOrganizationId: null, ...over,
});
const perms = (role: 'admin' | 'staff') => [...permissionsFor([role], { isOwner: false, isPlatform: false })];
const admin: TestCaller = { actor: actor(orgA), permissions: { [locA1]: perms('admin') }, modules: ['hospitality'] };
const staff: TestCaller = { actor: actor(orgA), permissions: { [locA1]: perms('staff') }, modules: ['hospitality'] };
const adminNoModule: TestCaller = { ...admin, modules: ['commerce'] };
const adminB: TestCaller = { actor: actor(orgB), permissions: { [locB]: perms('admin') }, modules: ['hospitality'] };
const root: TestCaller = { actor: actor(newId(), { isPlatform: true, actingOrganizationId: orgA }), permissions: {}, modules: [] };

beforeAll(async () => {
  t = await createHospitalityTestApp();
  for (const [id, organizationId] of [[locA1, orgA], [locA2, orgA], [locB, orgB]] as const) {
    t.core.add({ id, organizationId, timezone: 'America/Bogota', active: true });
  }
});
afterAll(() => t.app.close());

const base = `/locations/${locA1}`;

describe('F2-05 zonas y mesas', () => {
  it('admin crea zona y mesa, edita (PATCH) y lista', async () => {
    const zone = zoneSchema.parse((await t.as(admin).post(`${base}/zones`, { name: 'Terraza' })).body);
    const created = await t.as(admin).post(`${base}/tables`, { label: '1', zone_id: zone.id });
    expect(created.status).toBe(201);
    const table = tableSchema.parse(created.body);
    expect(table).toMatchObject({ zone_id: zone.id, zone_name: 'Terraza', display_name: 'Terraza · 1' });

    const patched = await t.as(admin).patch(`${base}/tables/${table.id}`, { label: '1A' });
    expect(patched.status).toBe(200);
    expect(tableSchema.parse(patched.body).display_name).toBe('Terraza · 1A');
    expect((await t.as(admin).patch(`${base}/zones/${zone.id}`, { name: 'Patio' })).body).toMatchObject({ name: 'Patio' });
    expect((await t.as(admin).get(`${base}/tables`)).body).toMatchObject([{ id: table.id, display_name: 'Patio · 1A' }]);
    expect((await t.as(admin).get(`${base}/zones`)).body).toHaveLength(1);
  });

  it('staff lee mesas y zonas pero no las modifica (403); módulo deshabilitado 403', async () => {
    expect((await t.as(staff).post(`${base}/zones`, { name: 'X' })).status).toBe(403);
    expect((await t.as(staff).post(`${base}/tables`, { label: '9' })).status).toBe(403);
    // El tablero del personal necesita los nombres de mesas y pisos (`hospitality.calls.read`).
    expect((await t.as(staff).get(`${base}/tables`)).status).toBe(200);
    expect((await t.as(staff).get(`${base}/zones`)).status).toBe(200);
    expect((await t.as(adminNoModule).post(`${base}/zones`, { name: 'X' })).status).toBe(403);
    expect((await t.as(adminNoModule).get(`${base}/tables`)).body).toMatchObject({ code: 'module_disabled' });
  });

  it('el mismo número en zonas distintas es válido; en la misma zona es 409', async () => {
    const a = zoneSchema.parse((await t.as(admin).post(`${base}/zones`, { name: 'Piso A' })).body);
    const b = zoneSchema.parse((await t.as(admin).post(`${base}/zones`, { name: 'Piso B' })).body);
    expect((await t.as(admin).post(`${base}/tables`, { label: '7', zone_id: a.id })).status).toBe(201);
    expect((await t.as(admin).post(`${base}/tables`, { label: '7', zone_id: b.id })).status).toBe(201);
    const dup = await t.as(admin).post(`${base}/tables`, { label: ' 7 ', zone_id: a.id });
    expect(dup.status).toBe(409);
    expect(dup.body).toMatchObject({ code: 'duplicate' });
    expect((await t.as(admin).post(`${base}/zones`, { name: 'piso a' })).status).toBe(409);
  });

  it('mesa o zona de otro local o negocio: 404; cuerpo inválido: 400; el tenant no sale del cuerpo', async () => {
    const adminBoth: TestCaller = { ...admin, permissions: { [locA1]: perms('admin'), [locA2]: perms('admin') } };
    const foreign = tableSchema.parse((await t.as(adminBoth).post(`/locations/${locA2}/tables`, { label: 'Z1' })).body);
    expect((await t.as(admin).patch(`${base}/tables/${foreign.id}`, { label: 'nuevo' })).status).toBe(404);
    expect((await t.as(admin).post(`${base}/tables/${foreign.id}/deactivate`)).status).toBe(404);
    expect((await t.as(admin).post(`${base}/tables`, { label: 'Y', zone_id: newId() })).status).toBe(404);
    // sin permiso en ese local: no se revela que existe
    expect((await t.as(admin).get(`/locations/${locA2}/tables`)).status).toBe(404);
    expect((await t.as(adminB).get(`${base}/tables`)).status).toBe(404);
    expect((await t.as(admin).post(`${base}/tables`, { label: '' })).status).toBe(400);
    expect((await t.as(admin).patch(`${base}/tables/${foreign.id}`, {})).status).toBe(400);
    const smuggled = tableSchema.parse((await t.as(admin).post(`${base}/tables`, { label: 'S', organization_id: orgB, location_id: locB })).body);
    expect((await t.as(adminBoth).get(`${base}/tables`)).body.some((x: { id: string }) => x.id === smuggled.id)).toBe(true);
    expect((await t.as(adminB).get(`/locations/${locB}/tables`)).body).toEqual([]);
  });

  it('desactivar: 204 sin cuerpo; la mesa deja de listarse; una zona con mesas activas se rechaza', async () => {
    const zone = zoneSchema.parse((await t.as(admin).post(`${base}/zones`, { name: 'Salón' })).body);
    const table = tableSchema.parse((await t.as(admin).post(`${base}/tables`, { label: 'D1', zone_id: zone.id })).body);
    expect((await t.as(admin).post(`${base}/zones/${zone.id}/deactivate`)).status).toBe(409);
    const off = await t.as(admin).post(`${base}/tables/${table.id}/deactivate`);
    expect(off.status).toBe(204);
    expect(off.text).toBe('');
    expect((await t.as(admin).get(`${base}/tables`)).body.some((x: { id: string }) => x.id === table.id)).toBe(false);
    expect((await t.as(admin).post(`${base}/zones/${zone.id}/deactivate`)).status).toBe(204);
    expect((await t.as(admin).post(`${base}/tables/${table.id}/deactivate`)).status).toBe(404);
  });
});

describe('F2-07 plataforma y F2-06 estado de botones', () => {
  const plat = `/platform/locations/${locA1}`;

  it('un admin de negocio recibe 403 en todas las rutas de plataforma', async () => {
    const attempts = [
      t.as(admin).post(`${plat}/gateways`, { name: 'gw' }), t.as(admin).get(`${plat}/gateways`), t.as(admin).post(`${plat}/devices`, { code: 'x' }),
      t.as(admin).get(`${plat}/devices`), t.as(admin).get(`${plat}/unknown-devices`),
      t.as(admin).post(`${plat}/devices/${newId()}/assign`, { table_id: newId() }), t.as(admin).post(`${plat}/devices/${newId()}/unassign`),
    ];
    expect((await Promise.all(attempts)).map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
  });

  it('la clave del gateway se entrega una sola vez; los listados nunca la incluyen', async () => {
    const created = await t.as(root).post(`${plat}/gateways`, { name: 'Barra' });
    expect(created.status).toBe(201);
    const { id, key } = gatewayCreatedSchema.parse(created.body);
    const listed = await t.as(root).get(`${plat}/gateways`);
    expect(gatewaySchema.array().parse(listed.body)).toMatchObject([{ id, name: 'Barra', last_seen_at: null, connected: false }]);
    expect(JSON.stringify(listed.body)).not.toContain(key);
    expect(JSON.stringify(listed.body)).not.toContain('key');
  });

  it('flujo: detectado sin asignar, registrar, asignar; el admin ve has_button sin datos técnicos', async () => {
    const table = tableSchema.parse((await t.as(admin).post(`${base}/tables`, { label: 'B1' })).body);
    const lonely = tableSchema.parse((await t.as(admin).post(`${base}/tables`, { label: 'B2' })).body);
    const gw = gatewayCreatedSchema.parse((await t.as(root).post(`${plat}/gateways`, { name: 'Salón' })).body);
    const seen = new Date();
    t.repos.events.add(DeviceEvent.create({
      organizationId: orgA, locationId: locA1, gatewayId: gw.id, deviceId: null, deviceCode: 'secret-btn-77', buttonKey: null, transport: 'http',
      payload: {}, sentAt: null, receivedAt: seen, result: 'unknown_device', correlationId: newId(),
    }));

    const unknown = unknownDeviceSchema.array().parse((await t.as(root).get(`${plat}/unknown-devices`)).body);
    expect(unknown).toMatchObject([{ device_code: 'secret-btn-77', count: 1 }]);
    const future = new Date(seen.getTime() + 60_000).toISOString();
    expect((await t.as(root).get(`${plat}/unknown-devices?since=${encodeURIComponent(future)}`)).body).toEqual([]);
    expect((await t.as(root).get(`${plat}/unknown-devices?since=ayer`)).status).toBe(400);

    const device = deviceSchema.parse((await t.as(root).post(`${plat}/devices`, { code: 'secret-btn-77', model: 'sim' })).body);
    expect((await t.as(root).post(`${plat}/devices`, { code: 'secret-btn-77' })).status).toBe(409);
    expect((await t.as(root).get(`${plat}/unknown-devices`)).body).toEqual([]);

    const before = deviceStatusSchema.parse((await t.as(staff).get(`${base}/device-status`)).body);
    expect(before.tables.find((x) => x.table_id === table.id)?.has_button).toBe(false);

    const assign = await t.as(root).post(`${plat}/devices/${device.id}/assign`, { table_id: table.id });
    expect(assign.status).toBe(204);
    expect(assign.text).toBe('');
    expect((await t.as(root).post(`${plat}/devices/${device.id}/assign`, { table_id: lonely.id })).status).toBe(409);
    expect(deviceSchema.array().parse((await t.as(root).get(`${plat}/devices`)).body)).toMatchObject([{ id: device.id, table_id: table.id }]);

    for (const who of [admin, staff]) {
      const res = await t.as(who).get(`${base}/device-status`);
      expect(res.status).toBe(200);
      const status = deviceStatusSchema.parse(res.body);
      expect(status.tables.find((x) => x.table_id === table.id)?.has_button).toBe(true);
      expect(status.tables.find((x) => x.table_id === lonely.id)?.has_button).toBe(false);
      expect(status.connectivity).toBe('some_disconnected');
      // Ningún dato técnico en la respuesta.
      const text = JSON.stringify(res.body);
      for (const secret of ['secret-btn-77', 'code', 'key_hash', 'gateway_id', 'key', gw.key, gw.id, device.id]) expect(text).not.toContain(secret);
    }

    expect((await t.as(root).post(`${plat}/devices/${device.id}/unassign`)).status).toBe(204);
    expect((await t.as(root).post(`${plat}/devices/${device.id}/unassign`)).status).toBe(404);
    expect(deviceStatusSchema.parse((await t.as(admin).get(`${base}/device-status`)).body).tables.find((x) => x.table_id === table.id)?.has_button).toBe(false);
  });

  it('el superadmin sin negocio elegido no opera: el local no es de su organización (404)', async () => {
    const noActing: TestCaller = { ...root, actor: { ...root.actor, actingOrganizationId: null } };
    expect((await t.as(noActing).get(`${plat}/gateways`)).status).toBe(404);
  });
});
