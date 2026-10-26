import { newId } from '@modivara/core-contracts';
import { createCommercePrisma, type CommercePrisma } from '../infrastructure/prisma/client.js';

export const TEST_COMMERCE_DATABASE_URL = 'postgresql://commerce_app:test@127.0.0.1:55432/modivara_test?schema=commerce';

export const commercePrismaForTests = (): CommercePrisma => createCommercePrisma(TEST_COMMERCE_DATABASE_URL);

/** Deja el esquema commerce vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetCommerce(prisma: CommercePrisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE outbox_events, stock_movements, stock_balances, movement_reasons, stock_locations, products CASCADE',
  );
}

/** Un negocio con un local (ids sin FK: viven en core). */
export const tenant = () => ({ organizationId: newId(), locationId: newId() });
export type TestTenant = ReturnType<typeof tenant>;
