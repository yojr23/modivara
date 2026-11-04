import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsModule } from '@modivara/analytics-api';
import { CommerceModule } from '@modivara/commerce-api';
import { BootstrapPlatform, CORE_PRISMA, CoreModule, ProvisionOrganization } from '@modivara/core-api';
import { AssignDevice, CreateGateway, CreateTable, DeactivateGateway, HOSPITALITY_OUTBOX, HospitalityModule, RegisterDevice, UnassignDevice } from '@modivara/hospitality-api';
import { IntegrationSubscribersModule } from '../integration-subscribers.module.js';

// SEC-06/PAT-02 de punta a punta: acción del superadmin en hospitality → su outbox → poller → fila en core.audit_log. Requiere db-test.
const CORE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
const HOSPITALITY_URL = 'postgresql://hospitality_app:test@127.0.0.1:55432/modivara_test?schema=hospitality';
const COMMERCE_URL = 'postgresql://commerce_app:test@127.0.0.1:55432/modivara_test?schema=commerce';
const ANALYTICS_URL = 'postgresql://analytics_app:test@127.0.0.1:55432/modivara_test?schema=analytics';
const MANUAL = { outbox: { intervalMs: 3_600_000 } };

const hospitality = HospitalityModule.forRoot({ databaseUrl: HOSPITALITY_URL, mqtt: null, ...MANUAL });
const commerce = CommerceModule.forRoot({ databaseUrl: COMMERCE_URL, ...MANUAL });
const analytics = AnalyticsModule.forRoot({ databaseUrl: ANALYTICS_URL });

@Module({ imports: [CoreModule.forRoot({ databaseUrl: CORE_URL, outbox: false }), hospitality, commerce, analytics, IntegrationSubscribersModule.forDomains({ hospitality, commerce, analytics })] })
class HostModule {}

type Raw = { $executeRawUnsafe(sql: string): Promise<unknown>; auditLog: { findMany(a: unknown): Promise<Array<Record<string, unknown>>> } };
let app: INestApplication;
const get = <T>(token: string | (new (...a: never[]) => T)) => app.get<T>(token as never, { strict: false });
const tickHospitality = () => get<{ tick(): Promise<number> }>(HOSPITALITY_OUTBOX).tick();
const audit = () => get<Raw>(CORE_PRISMA).auditLog.findMany({ orderBy: { occurredAt: 'asc' } });

beforeAll(async () => {
  app = (await Test.createTestingModule({ imports: [HostModule] }).compile()).createNestApplication();
  await app.init();
});
afterAll(() => app.close());
beforeEach(async () => {
  await get<Raw>(CORE_PRISMA).$executeRawUnsafe('TRUNCATE outbox_events, audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE');
  await get<Raw>('HOSPITALITY_PRISMA').$executeRawUnsafe('TRUNCATE outbox_events, device_assignments, devices, gateways, dining_tables, zones, location_settings CASCADE');
});

describe('auditoría de acciones de plataforma de hospitality', () => {
  it('cada acción queda en core.audit_log con actor, negocio, local, recurso y fecha; reentregar no duplica', async () => {
    const root = await get(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: 'Secret123' });
    const { organization, locations } = await get(ProvisionOrganization).execute({
      actor: root, slug: 'bar-audit', name: 'Bar Audit', locations: [{ name: 'Centro' }], modules: ['hospitality'],
    });
    const ctx = { organizationId: organization.id, locationId: locations[0]!.id, actorUserId: root.actorUserId };

    const table = await get(CreateTable).execute({ ...ctx, label: '1' });
    const { gateway, plainKey } = await get(CreateGateway).execute({ ...ctx, name: 'GW1' });
    await get(CreateGateway).execute({ ...ctx, name: 'GW2' });
    const device = await get(RegisterDevice).execute({ ...ctx, code: 'B1' });
    await get(AssignDevice).execute({ ...ctx, deviceId: device.id, tableId: table.id });
    await get(UnassignDevice).execute({ ...ctx, deviceId: device.id });
    await get(DeactivateGateway).execute({ ...ctx, gatewayId: gateway.id });

    expect(await audit()).toEqual([]);
    expect(await tickHospitality()).toBe(6);
    const rows = await audit();
    expect(rows.map((r) => r.action).sort()).toEqual(['device.assigned', 'device.created', 'device.unassigned', 'gateway.created', 'gateway.created', 'gateway.deactivated']);
    expect(rows.find((r) => r.action === 'device.assigned')).toMatchObject({
      organizationId: organization.id, actorUserId: root.actorUserId, targetType: 'device', targetId: device.id,
      details: { locationId: ctx.locationId, tableId: table.id },
    });
    expect(rows.find((r) => r.action === 'gateway.deactivated')).toMatchObject({ targetType: 'gateway', targetId: gateway.id });
    expect(rows.every((r) => r.occurredAt instanceof Date)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(plainKey);

    // Reentrega (el poller es at-least-once): mismo event_id = misma fila.
    await get<Raw>('HOSPITALITY_PRISMA').$executeRawUnsafe('UPDATE outbox_events SET dispatched_at = NULL, next_attempt_at = now()');
    expect(await tickHospitality()).toBe(6);
    expect(await audit()).toHaveLength(6);
  });
});
