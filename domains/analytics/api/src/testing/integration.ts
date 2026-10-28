import { newId } from '@modivara/core-contracts';
import { createAnalyticsPrisma, type AnalyticsPrisma } from '../infrastructure/prisma/client.js';

export const TEST_ANALYTICS_DATABASE_URL = 'postgresql://analytics_app:test@127.0.0.1:55432/modivara_test?schema=analytics';

export const analyticsPrismaForTests = (): AnalyticsPrisma => createAnalyticsPrisma(TEST_ANALYTICS_DATABASE_URL);

/** Deja el esquema analytics vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetAnalytics(prisma: AnalyticsPrisma): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE processed_events, service_call_facts, stock_movement_facts');
}

export const tenant = () => ({ organizationId: newId(), locationId: newId() });
