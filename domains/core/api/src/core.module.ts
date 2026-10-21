import { Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { CORE_ACCESS_PORT } from '@modivara/core-contracts';
import {
  Authorize, AuthenticateSession, BootstrapPlatform, ChangePassword, CoreAccessService, CreateUser, DeactivateUser, GetMe, ListUsers, Login, Logout,
  ProvisionOrganization, ResetPassword, ResolveLocationAccess, RevokeUserSessions, SelectActingOrganization, SetLocationRoles,
} from './application/index.js';
import type { AdminTransactions, AuditLog, EntitlementRepository, LocationRepository, MembershipRepository, OrganizationRepository, PasswordHasher, SessionRepository, SessionTokenService, UserRepository } from './application/ports/index.js';
import { AuthController, LoginRateLimiter, PlatformController, UsersController } from './presentation/index.js';
import { Argon2PasswordHasher, CryptoSessionTokenService } from './infrastructure/index.js';
import {
  createCorePrisma, PrismaAdminTransactions, PrismaAuditLog, PrismaEntitlementRepository, PrismaLocationRepository, PrismaMembershipRepository,
  PrismaOrganizationRepository, PrismaSessionRepository, PrismaUserRepository, type CorePrisma,
} from './infrastructure/prisma/index.js';

// Tokens de inyección de los puertos (strings: no dependen de identidad de clase ni de módulos duplicados).
export const CORE_PRISMA = 'CORE_PRISMA';
export const ORGANIZATIONS = 'CORE_ORGANIZATIONS';
export const LOCATIONS = 'CORE_LOCATIONS';
export const USERS = 'CORE_USERS';
export const MEMBERSHIPS = 'CORE_MEMBERSHIPS';
export const SESSIONS = 'CORE_SESSIONS';
export const ENTITLEMENTS = 'CORE_ENTITLEMENTS';
export const AUDIT_LOG = 'CORE_AUDIT_LOG';
export const ADMIN_TRANSACTIONS = 'CORE_ADMIN_TRANSACTIONS';
export const PASSWORD_HASHER = 'CORE_PASSWORD_HASHER';
export const SESSION_TOKENS = 'CORE_SESSION_TOKENS';

export interface CoreModuleOptions {
  /** Por defecto, `CORE_DATABASE_URL` del entorno. */
  databaseUrl?: string;
}

/** Casos de uso: token = la clase, deps = tokens de puertos en el orden de su constructor. */
const useCases = [
  [Login, [ORGANIZATIONS, USERS, SESSIONS, PASSWORD_HASHER, SESSION_TOKENS]],
  [Logout, [SESSIONS, SESSION_TOKENS]],
  [AuthenticateSession, [SESSIONS, USERS, ORGANIZATIONS, SESSION_TOKENS]],
  [ChangePassword, [ADMIN_TRANSACTIONS, PASSWORD_HASHER]],
  [CreateUser, [ADMIN_TRANSACTIONS, PASSWORD_HASHER]],
  [DeactivateUser, [ADMIN_TRANSACTIONS]],
  [ResetPassword, [ADMIN_TRANSACTIONS, PASSWORD_HASHER]],
  [RevokeUserSessions, [ADMIN_TRANSACTIONS]],
  [SetLocationRoles, [ADMIN_TRANSACTIONS]],
  [SelectActingOrganization, [ADMIN_TRANSACTIONS]],
  [ResolveLocationAccess, [LOCATIONS, MEMBERSHIPS, ENTITLEMENTS]],
  [Authorize, [ResolveLocationAccess, MEMBERSHIPS, ENTITLEMENTS]],
  [GetMe, [USERS, ORGANIZATIONS, LOCATIONS, MEMBERSHIPS, ENTITLEMENTS]],
  [ListUsers, [USERS, MEMBERSHIPS]],
  [ProvisionOrganization, [ADMIN_TRANSACTIONS]],
  [BootstrapPlatform, [ADMIN_TRANSACTIONS, PASSWORD_HASHER]],
] as const;

@Module({})
export class CoreModule implements OnModuleDestroy {
  constructor(@Inject(CORE_PRISMA) private readonly prisma: CorePrisma) {}

  static forRoot(options: CoreModuleOptions = {}): DynamicModule {
    const databaseUrl = options.databaseUrl ?? process.env.CORE_DATABASE_URL;
    return {
      module: CoreModule,
      // Global: otros dominios inyectan CORE_ACCESS_PORT por token sin importar core-api (ADR-002 D1).
      global: true,
      controllers: [AuthController, UsersController, PlatformController],
      providers: [
        LoginRateLimiter,
        {
          provide: CORE_PRISMA,
          useFactory: () => {
            if (!databaseUrl) throw new Error('CORE_DATABASE_URL is required (or pass databaseUrl to CoreModule.forRoot)');
            return createCorePrisma(databaseUrl);
          },
        },
        { provide: ORGANIZATIONS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): OrganizationRepository => new PrismaOrganizationRepository(p) },
        { provide: LOCATIONS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): LocationRepository => new PrismaLocationRepository(p) },
        { provide: USERS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): UserRepository => new PrismaUserRepository(p) },
        { provide: MEMBERSHIPS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): MembershipRepository => new PrismaMembershipRepository(p) },
        { provide: SESSIONS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): SessionRepository => new PrismaSessionRepository(p) },
        { provide: ENTITLEMENTS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): EntitlementRepository => new PrismaEntitlementRepository(p) },
        { provide: AUDIT_LOG, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): AuditLog => new PrismaAuditLog(p) },
        { provide: ADMIN_TRANSACTIONS, inject: [CORE_PRISMA], useFactory: (p: CorePrisma): AdminTransactions => new PrismaAdminTransactions(p) },
        { provide: PASSWORD_HASHER, useFactory: (): PasswordHasher => new Argon2PasswordHasher() },
        { provide: SESSION_TOKENS, useFactory: (): SessionTokenService => new CryptoSessionTokenService() },
        ...useCases.map(([useCase, deps]) => ({
          provide: useCase,
          inject: [...deps],
          useFactory: (...args: unknown[]) => new (useCase as new (...a: unknown[]) => unknown)(...args),
        })),
        { provide: CORE_ACCESS_PORT, inject: [LOCATIONS], useFactory: (l: LocationRepository) => new CoreAccessService(l) },
      ],
      exports: [CORE_ACCESS_PORT, ...useCases.map(([useCase]) => useCase)],
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
