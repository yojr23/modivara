import type { ModuleName } from '@modivara/core-contracts';
import type { AppUser, Entitlement, Location, LocationMembership, Organization, Session } from '../domain/index.js';
import type {
  EntitlementRepository,
  LocationRepository,
  MembershipRepository,
  OrganizationRepository,
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  UserRepository,
} from '../application/ports/index.js';

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly items = new Map<string, Organization>();
  async findById(id: string) { return this.items.get(id) ?? null; }
  async findBySlug(slug: string) { return [...this.items.values()].find((o) => o.slug === slug) ?? null; }
  async save(o: Organization) { this.items.set(o.id, o); }
}

export class InMemoryLocationRepository implements LocationRepository {
  readonly items = new Map<string, Location>();
  async findById(id: string) { return this.items.get(id) ?? null; }
  async save(l: Location) { this.items.set(l.id, l); }
}

export class InMemoryUserRepository implements UserRepository {
  readonly items = new Map<string, AppUser>();
  saves = 0;
  async findById(id: string) { return this.items.get(id) ?? null; }
  async findActiveByUsername(organizationId: string, username: string) {
    return [...this.items.values()].find((u) => u.organizationId === organizationId && u.username === username && u.isActive) ?? null;
  }
  async save(u: AppUser) { this.saves++; this.items.set(u.id, u); }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  readonly items = new Map<string, LocationMembership>();
  async findActive(userId: string, locationId: string) {
    return [...this.items.values()].find((m) => m.userId === userId && m.locationId === locationId && m.isActive) ?? null;
  }
  async listActiveByUser(userId: string) {
    return [...this.items.values()].filter((m) => m.userId === userId && m.isActive);
  }
  async save(m: LocationMembership) { this.items.set(m.id, m); }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly items = new Map<string, Session>();
  saves = 0;
  async findById(id: string) { return this.items.get(id) ?? null; }
  async findByTokenHash(tokenHash: string) { return [...this.items.values()].find((s) => s.tokenHash === tokenHash) ?? null; }
  async save(s: Session) { this.saves++; this.items.set(s.id, s); }
  async revokeAllForUser(userId: string, now: Date) {
    for (const s of this.items.values()) if (s.userId === userId) s.revoke(now);
  }
}

export class InMemoryEntitlementRepository implements EntitlementRepository {
  readonly items: Entitlement[] = [];
  async listEnabledModules(organizationId: string): Promise<ModuleName[]> {
    return this.items.filter((e) => e.organizationId === organizationId && e.enabled).map((e) => e.module);
  }
  async find(organizationId: string, module: ModuleName) {
    return this.items.find((e) => e.organizationId === organizationId && e.module === module) ?? null;
  }
  async save(e: Entitlement) {
    if (!this.items.includes(e)) this.items.push(e);
  }
}

/** Hash trivial y rápido para pruebas de casos de uso; el real se prueba en infrastructure. */
export class FakePasswordHasher implements PasswordHasher {
  async hash(plain: string) { return `fake:${plain}`; }
  async verify(hash: string, plain: string) { return hash === `fake:${plain}`; }
}

export class FakeSessionTokenService implements SessionTokenService {
  private n = 0;
  generate() {
    const token = `token-${++this.n}`;
    return { token, tokenHash: this.hash(token) };
  }
  hash(token: string) { return `hash(${token})`; }
}
