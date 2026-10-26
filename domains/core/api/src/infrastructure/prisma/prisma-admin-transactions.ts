import type { AdminTransaction, AdminTransactions, AuditLog } from '../../application/ports/index.js';
import type { CorePrisma } from './client.js';
import type { Db } from './db.js';
import { PrismaAuditLog } from './prisma-audit-log.js';
import { PrismaEntitlementRepository } from './prisma-entitlement-repository.js';
import { PrismaLocationRepository } from './prisma-location-repository.js';
import { PrismaMembershipRepository } from './prisma-membership-repository.js';
import { PrismaOutbox } from './prisma-outbox.js';
import { PrismaOrganizationRepository } from './prisma-organization-repository.js';
import { PrismaSessionRepository } from './prisma-session-repository.js';
import { PrismaUserRepository } from './prisma-user-repository.js';

/** Transacción interactiva de Prisma: los adaptadores comparten el cliente transaccional, así que cambio y auditoría confirman o revierten juntos. */
export class PrismaAdminTransactions implements AdminTransactions {
  /** `auditFor` solo se sustituye en pruebas (para forzar el fallo de la auditoría). */
  constructor(
    private readonly prisma: CorePrisma,
    private readonly auditFor: (tx: Db) => AuditLog = (tx) => new PrismaAuditLog(tx),
  ) {}

  withTransaction<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((db) =>
      work({
        organizations: new PrismaOrganizationRepository(db),
        locations: new PrismaLocationRepository(db),
        users: new PrismaUserRepository(db),
        memberships: new PrismaMembershipRepository(db),
        sessions: new PrismaSessionRepository(db),
        entitlements: new PrismaEntitlementRepository(db),
        audit: this.auditFor(db),
        outbox: new PrismaOutbox(db),
      }),
    { timeout: 15_000 });
  }
}
