import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMMERCE_OUTBOX, CommerceModule, ListMovementReasons, ListStockLocations } from '@modivara/commerce-api';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { BootstrapPlatform, CORE_OUTBOX, CoreModule, ProvisionOrganization } from '@modivara/core-api';
import { HOSPITALITY_OUTBOX, HospitalityModule } from '@modivara/hospitality-api';
import { IntegrationSubscribersModule } from '../integration-subscribers.module.js';

// Q-05 de punta a punta: provisionar un negocio en core → su outbox → suscriptores de commerce y hospitality. Requiere db-test.
const CORE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
const HOSPITALITY_URL = 'postgresql://hospitality_app:test@127.0.0.1:55432/modivara_test?schema=hospitality';
const COMMERCE_URL = 'postgresql://commerce_app:test@127.0.0.1:55432/modivara_test?schema=commerce';
const MANUAL = { outbox: { intervalMs: 3_600_000 } }; // solo `tick()` manual: la prueba controla cuándo se entrega

const hospitality = HospitalityModule.forRoot({ databaseUrl: HOSPITALITY_URL, mqtt: null, ...MANUAL });
const commerce = CommerceModule.forRoot({ databaseUrl: COMMERCE_URL, ...MANUAL });

@Module({ imports: [CoreModule.forRoot({ databaseUrl: CORE_URL, ...MANUAL }), hospitality, commerce, IntegrationSubscribersModule.forDomains({ hospitality, commerce })] })
class HostModule {}

type Raw = { $executeRawUnsafe(sql: string): Promise<unknown>; $queryRawUnsafe<T>(sql: string): Promise<T> };
let app: INestApplication;
const get = <T>(token: string | (new (...a: never[]) => T)) => app.get<T>(token as never, { strict: false });
const raw = (token: string) => get<Raw>(token);
const tickCore = () => get<{ tick(): Promise<number> }>(CORE_OUTBOX).tick();

beforeAll(async () => {
  app = (await Test.createTestingModule({ imports: [HostModule] }).compile()).createNestApplication();
  await app.init();
});
afterAll(() => app.close());
beforeEach(async () => {
  await raw('CORE_PRISMA').$executeRawUnsafe('TRUNCATE outbox_events, audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE');
  await raw('HOSPITALITY_PRISMA').$executeRawUnsafe('TRUNCATE outbox_events, location_settings, zones CASCADE');
  await raw('COMMERCE_PRISMA').$executeRawUnsafe('TRUNCATE outbox_events, stock_movements, stock_balances, movement_reasons, stock_locations, products CASCADE');
});

async function provision() {
  const root = await get(BootstrapPlatform).execute({ username: 'superadmin', displayName: 'Superadmin', password: 'Secret123' });
  const { organization, locations } = await get(ProvisionOrganization).execute({
    actor: root, slug: 'bar-eventos', name: 'Bar Eventos', locations: [{ name: 'Centro' }, { name: 'Norte' }], modules: ['hospitality', 'commerce'],
  });
  return { root, organization, locations };
}

const observed = async (organizationId: string, locationIds: string[], actorUserId: string) => ({
  reasons: (await get(ListMovementReasons).execute({ organizationId, actorUserId })).length,
  places: await Promise.all(locationIds.map(async (locationId) =>
    (await get(ListStockLocations).execute({ organizationId, locationId, actorUserId })).map((s) => [s.name, s.isDefault]))),
  settings: await raw('HOSPITALITY_PRISMA').$queryRawUnsafe<Array<{ location_id: string; call_visibility: string }>>(
    'SELECT location_id, call_visibility FROM location_settings ORDER BY location_id',
  ),
});

describe('core.location.created.v1 entre módulos', () => {
  it('tras provisionar y un tick existen motivos, «Principal» por local y location_settings; reentregar no duplica', async () => {
    const { root, organization, locations } = await provision();
    const ids = locations.map((l) => l.id);
    expect(await observed(organization.id, ids, root.actorUserId)).toMatchObject({ reasons: 0, settings: [] });

    expect(await tickCore()).toBe(2);
    const after = await observed(organization.id, ids, root.actorUserId);
    expect(after.reasons).toBe(SEEDED_MOVEMENT_REASONS.length);
    expect(after.places).toEqual([[['Principal', true]], [['Principal', true]]]);
    expect(after.settings.map((s) => s.location_id).sort()).toEqual([...ids].sort());
    expect(after.settings.every((s) => s.call_visibility === 'all')).toBe(true);

    // Reentrega del mismo evento (p. ej. caída justo después de entregar): vuelve a quedar pendiente y se entrega otra vez.
    await raw('CORE_PRISMA').$executeRawUnsafe('UPDATE outbox_events SET dispatched_at = NULL, next_attempt_at = now()');
    expect(await tickCore()).toBe(2);
    expect(await observed(organization.id, ids, root.actorUserId)).toEqual(after);
  });

  it('los pollers de commerce y hospitality siguen operativos (sin eventos propios que entregar)', async () => {
    expect(await get<{ tick(): Promise<number> }>(COMMERCE_OUTBOX).tick()).toBe(0);
    expect(await get<{ tick(): Promise<number> }>(HOSPITALITY_OUTBOX).tick()).toBe(0);
  });
});
