import type { ModuleName } from '@modivara/core-contracts';
import type { AppUser, Entitlement, Location, LocationMembership, Organization, Session } from '../domain/index.js';
import type {
  AuditEntry,
  AuditLog,
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
  async findById({ id }: { id: string }) { return this.items.get(id) ?? null; }
  async findBySlug({ slug }: { slug: string }) { return [...this.items.values()].find((o) => o.slug === slug) ?? null; }
  async save(o: Organization) { this.items.set(o.id, o); }
}

export class InMemoryLocationRepository implements LocationRepository {
  readonly items = new Map<string, Location>();
  constructor(private readonly organizations: InMemoryOrganizationRepository) {}
  async findById({ id, organizationId }: { id: string; organizationId: string }) {
    const l = this.items.get(id);
    return l && l.organizationId === organizationId ? l : null;
  }
  async findByIdWithOrganization({ id, organizationId }: { id: string; organizationId?: string }) {
    const location = this.items.get(id);
    if (!location || (organizationId !== undefined && location.organizationId !== organizationId)) return null;
    const org = await this.organizations.findById({ id: location.organizationId });
    return { location, organizationActive: !!org?.isActive };
  }
  async save(l: Location) { this.items.set(l.id, l); }
}

export class InMemoryUserRepository implements UserRepository {
  readonly items = new Map<string, AppUser>();
  saves = 0;
  async findById({ id, organizationId }: { id: string; organizationId: string }) {
    const u = this.items.get(id);
    return u && u.organizationId === organizationId ? u : null;
  }
  async findByIdForSession({ id }: { id: string }) { return this.items.get(id) ?? null; }
  async findActiveByUsername({ organizationId, username }: { organizationId: string; username: string }) {
    return [...this.items.values()].find((u) => u.organizationId === organizationId && u.username === username && u.isActive) ?? null;
  }
  async save(u: AppUser) { this.saves++; this.items.set(u.id, u); }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  readonly items = new Map<string, LocationMembership>();
  async findActive({ organizationId, userId, locationId }: { organizationId: string; userId: string; locationId: string }) {
    return [...this.items.values()].find((m) => m.organizationId === organizationId && m.userId === userId && m.locationId === locationId && m.isActive) ?? null;
  }
  async listActiveByUser({ organizationId, userId }: { organizationId: string; userId: string }) {
    return [...this.items.values()].filter((m) => m.organizationId === organizationId && m.userId === userId && m.isActive);
  }
  async save(m: LocationMembership) { this.items.set(m.id, m); }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly items = new Map<string, Session>();
  saves = 0;
  async findById({ id, userId }: { id: string; userId: string }) {
    const s = this.items.get(id);
    return s && s.userId === userId ? s : null;
  }
  async findByTokenHash({ tokenHash }: { tokenHash: string }) { return [...this.items.values()].find((s) => s.tokenHash === tokenHash) ?? null; }
  async save(s: Session) { this.saves++; this.items.set(s.id, s); }
  async revokeAllForUser({ userId }: { organizationId: string; userId: string }, now: Date) {
    for (const s of this.items.values()) if (s.userId === userId) s.revoke(now);
  }
}

export class InMemoryEntitlementRepository implements EntitlementRepository {
  readonly items: Entitlement[] = [];
  async listEnabledModules({ organizationId }: { organizationId: string }): Promise<ModuleName[]> {
    return this.items.filter((e) => e.organizationId === organizationId && e.enabled).map((e) => e.module);
  }
  async find({ organizationId, module }: { organizationId: string; module: ModuleName }) {
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

export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];
  async record(entry: AuditEntry) { this.entries.push(entry); }
}
