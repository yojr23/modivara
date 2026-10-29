import { newId } from '@modivara/core-contracts';
import { createHospitalityPrisma, type HospitalityPrisma } from '../infrastructure/prisma/client.js';

export const TEST_HOSPITALITY_DATABASE_URL = 'postgresql://hospitality_app:test@127.0.0.1:55432/modivara_test?schema=hospitality';

export const hospitalityPrismaForTests = (): HospitalityPrisma => createHospitalityPrisma(TEST_HOSPITALITY_DATABASE_URL);

/** Deja el esquema hospitality vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetHospitality(prisma: HospitalityPrisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events, device_events, service_call_transitions, service_calls, device_assignments, devices, gateways, space_layouts, dining_tables, zones, location_settings CASCADE',
  );
}

/** Dos locales de dos negocios distintos (ids sin FK: viven en core). */
export const tenant = () => ({ organizationId: newId(), locationId: newId() });
export type TestTenant = ReturnType<typeof tenant>;
