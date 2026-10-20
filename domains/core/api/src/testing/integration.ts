import { createCorePrisma, type CorePrisma } from '../infrastructure/prisma/client.js';

export const TEST_CORE_DATABASE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';

export const corePrismaForTests = (): CorePrisma => createCorePrisma(TEST_CORE_DATABASE_URL);

/** Deja el esquema core vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetCore(prisma: CorePrisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE',
  );
}
