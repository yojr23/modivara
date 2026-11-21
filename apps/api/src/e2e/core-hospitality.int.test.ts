import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_PRISMA } from '@modivara/core-api';
import { INTEGRATION_EVENT_SUBSCRIBERS } from '@modivara/core-contracts';
import { HospitalityModule } from '@modivara/hospitality-api';
import { GATEWAY_API_PATHS, GATEWAY_KEY_HEADER, serviceCallPageSchema, serviceCallSchema } from '@modivara/hospitality-contracts';
import { HOST_TIMEOUT, MANUAL, type Raw, startPartialHost } from './partial-host.js';

// PLAN-003 T07 + T12 (hospitality): host Core + Hospitality, sin Commerce ni Analytics (ni variables, ni módulos, ni esquemas).
let host: Awaited<ReturnType<typeof startPartialHost>>;
beforeAll(async () => {
  host = await startPartialHost('modivara_core_hospitality', ['hospitality'], (url) => [
    HospitalityModule.forRoot({ databaseUrl: url('hospitality'), mqtt: null, ...MANUAL }),
  ]);
}, HOST_TIMEOUT);
afterAll(() => host?.close());

describe('T07 host Core + Hospitality (sin Commerce ni Analytics)', () => {
  it('no instancia providers ni consumidores de Commerce/Analytics y la base no tiene sus esquemas', async () => {
    for (const token of ['COMMERCE_PRISMA', 'COMMERCE_OUTBOX', 'ANALYTICS_PRISMA', 'ANALYTICS_EVENT_SUBSCRIBER']) expect(() => host.get(token)).toThrow();
    expect(host.get<Array<{ name: string }>>(INTEGRATION_EVENT_SUBSCRIBERS).map((s) => s.name)).toEqual(['core.platform-action-audit', 'hospitality.location-created']);
    const schemas = await host.get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ nspname: string }>>(
      "SELECT nspname FROM pg_namespace WHERE nspname IN ('core', 'commerce', 'hospitality', 'analytics') ORDER BY nspname",
    );
    expect(schemas.map((s) => s.nspname)).toEqual(['core', 'hospitality']);
  });

  it('mesa, pulsación y ciclo del llamado; T12: suspender → 403 module_disabled sin borrar nada, reactivar sin duplicar', async () => {
    const { organizationId, locationId } = await host.provision('bar', ['hospitality'], { admin: 'admin', mesero: 'staff' });
    await host.tickCore(); // core.location.created → hospitality crea location_settings
    const superadmin = host.as(await host.login('labs', 'superadmin'));
    const admin = host.as(await host.login('bar', 'admin'));
    const mesero = host.as(await host.login('bar', 'mesero'));

    await superadmin.put('/platform/acting-organization', { organization_id: organizationId });
    const gateway = (await superadmin.post(`/platform/locations/${locationId}/gateways`, { name: 'GW' })).body as { key: string };
    const device = (await superadmin.post(`/platform/locations/${locationId}/devices`, { code: 'btn-01' })).body as { id: string };
    const table = await admin.post(`/locations/${locationId}/tables`, { label: '1' });
    expect(table.status).toBe(201);
    expect((await superadmin.post(`/platform/locations/${locationId}/devices/${device.id}/assign`, { table_id: table.body.id })).status).toBeLessThan(300);

    const press = await request(host.origin).post(`/api/v1${GATEWAY_API_PATHS.deviceEvents}`).set(GATEWAY_KEY_HEADER, gateway.key).send({ device_code: 'btn-01' });
    expect(press.status).toBe(200);
    const calls = `/locations/${locationId}/service-calls`;
    const [call] = serviceCallPageSchema.parse((await mesero.get(calls)).body).items;
    expect(call!.table_id).toBe(table.body.id);
    expect(serviceCallSchema.parse((await mesero.post(`${calls}/${call!.id}/acknowledge`)).body).status).toBe('in_progress');
    expect(serviceCallSchema.parse((await mesero.post(`${calls}/${call!.id}/complete`)).body).status).toBe('completed');

    const db = host.get<Raw>('HOSPITALITY_PRISMA');
    const rows = async () => {
      const count = async (t: string) => (await db.$queryRawUnsafe<[{ n: number }]>(`SELECT count(*)::int AS n FROM ${t} WHERE location_id = '${locationId}'`))[0].n;
      return { settings: await count('location_settings'), tables: await count('dining_tables'), calls: await count('service_calls') };
    };
    const EXPECTED = { settings: 1, tables: 1, calls: 1 };
    expect(await rows()).toEqual(EXPECTED);

    const path = `/platform/organizations/${organizationId}/modules/hospitality`;
    expect((await superadmin.put(path, { enabled: false })).body).toEqual({ module: 'hospitality', enabled: false });
    await host.tickCore();
    for (const [who, p] of [[admin, `/locations/${locationId}/tables`], [mesero, calls], [mesero, `${calls}/${call!.id}`]] as const) {
      const res = await who.get(p);
      expect([p, res.status, res.body.code]).toEqual([p, 403, 'module_disabled']);
    }
    expect((await admin.get('/me')).status).toBe(200); // core sigue operando
    expect(await rows()).toEqual(EXPECTED);

    expect((await superadmin.put(path, { enabled: true })).body).toEqual({ module: 'hospitality', enabled: true });
    await host.tickCore();
    expect(await rows()).toEqual(EXPECTED);
    expect(((await admin.get(`/locations/${locationId}/tables`)).body as Array<{ id: string }>).map((t) => t.id)).toEqual([table.body.id]);
    expect(serviceCallSchema.parse((await mesero.get(`${calls}/${call!.id}`)).body).status).toBe('completed');
    const audit = await host.get<Raw>(CORE_PRISMA).$queryRawUnsafe<Array<{ action: string }>>(
      `SELECT action FROM audit_log WHERE organization_id = '${organizationId}' AND action LIKE 'entitlement.%' ORDER BY occurred_at`,
    );
    expect(audit.map((a) => a.action)).toEqual(['entitlement.enabled', 'entitlement.disabled', 'entitlement.enabled']);
  });
});
