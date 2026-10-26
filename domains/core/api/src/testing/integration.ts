import { newId } from '@modivara/core-contracts';
import { AppUser, Location, Organization } from '../domain/index.js';
import { createCorePrisma, type CorePrisma } from '../infrastructure/prisma/client.js';
import { PrismaLocationRepository } from '../infrastructure/prisma/prisma-location-repository.js';
import { PrismaOrganizationRepository } from '../infrastructure/prisma/prisma-organization-repository.js';
import { PrismaUserRepository } from '../infrastructure/prisma/prisma-user-repository.js';

export const TEST_CORE_DATABASE_URL = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';

export const corePrismaForTests = (): CorePrisma => createCorePrisma(TEST_CORE_DATABASE_URL);

/** Deja el esquema core vacío entre pruebas (las migraciones ya están aplicadas por el globalSetup). */
export async function resetCore(prisma: CorePrisma): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_log, outbox_events, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE',
  );
}

// Semillas con las entidades y adaptadores reales (no SQL a mano), para las pruebas de integración.
export async function seedOrganization(prisma: CorePrisma, slug = 'bar-sol', opts: { isPlatform?: boolean } = {}) {
  const org = Organization.create({ id: newId(), slug, name: slug, isPlatform: opts.isPlatform });
  await new PrismaOrganizationRepository(prisma).save(org);
  return org;
}

export async function seedLocation(prisma: CorePrisma, org: Organization, name = 'Centro', timezone?: string) {
  const location = Location.create({ id: newId(), organizationId: org.id, name, timezone });
  await new PrismaLocationRepository(prisma).save(location);
  return location;
}

export async function seedUser(prisma: CorePrisma, org: Organization, username = 'ana', passwordHash = 'hash') {
  const user = AppUser.create({ id: newId(), organizationId: org.id, username, displayName: username, passwordHash, now: new Date() });
  await new PrismaUserRepository(prisma).save(user);
  return user;
}
