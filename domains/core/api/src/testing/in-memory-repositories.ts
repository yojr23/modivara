import type { ModuleName } from '@modivara/core-contracts';
import { AppUser } from '../domain/index.js';
import type { Entitlement, Location, LocationMembership, Organization, Session } from '../domain/index.js';
import type {
  AdminTransaction,
  AdminTransactions,
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
  async listActive({ organizationId }: { organizationId: string }) {
    return [...this.items.values()].filter((l) => l.organizationId === organizationId && l.isActive).sort((a, b) => a.name.localeCompare(b.name));
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
  async listActive({ organizationId }: { organizationId: string }) {
    return [...this.items.values()].filter((u) => u.organizationId === organizationId && u.isActive).sort((a, b) => a.username.localeCompare(b.username));
  }
  async save(u: AppUser) { this.saves++; this.items.set(u.id, u); }

  readonly #locks = new Map<string, Promise<unknown>>();
  /** Serializa por usuario y trabaja sobre una copia, como una transacción: sin el bloqueo habría actualizaciones perdidas. */
  async withLoginLock<T>(
    { id, organizationId }: { id: string; organizationId: string },
    work: (tx: { user: AppUser | null; save(user: AppUser): Promise<void> }) => Promise<T>,
  ): Promise<T> {
    const previous = this.#locks.get(id) ?? Promise.resolve();
    const run = previous.then(async () => {
      const stored = await this.findById({ id, organizationId });
      const user = stored?.isActive
        ? AppUser.restore({
            id: stored.id, organizationId: stored.organizationId, username: stored.username, displayName: stored.displayName,
            passwordHash: stored.passwordHash, isOwner: stored.isOwner, passwordChangedAt: stored.passwordChangedAt,
            failedLoginCount: stored.failedLoginCount, failedLoginWindowStart: stored.failedLoginWindowStart,
            deactivatedAt: stored.deactivatedAt,
          })
        : null;
      return work({ user, save: (u) => this.save(u) });
    });
    this.#locks.set(id, run.catch(() => undefined));
    return run;
  }
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
  /** Escrituras de `touch` (para comprobar que se hacen como máximo una vez por hora). */
  touches = 0;
  async findById({ id, userId }: { id: string; userId: string }) {
    const s = this.items.get(id);
    return s && s.userId === userId ? s : null;
  }
  async findByTokenHash({ tokenHash }: { tokenHash: string }) { return [...this.items.values()].find((s) => s.tokenHash === tokenHash) ?? null; }
  async create(s: Session) { this.items.set(s.id, s); }
  // Como el adaptador real, cada operación solo "escribe" sus campos; el doble comparte la instancia, así que basta registrar la llamada.
  async touch(s: Session) { if (this.items.has(s.id)) this.touches++; }
  async revoke(s: Session) { if (!this.items.has(s.id)) this.items.set(s.id, s); }
  async setActingOrganization(s: Session) { if (!this.items.has(s.id)) this.items.set(s.id, s); }
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

type Store = Map<string, unknown> | unknown[];
const snapshot = (store: Store) => (store instanceof Map ? new Map(store) : [...store]);
const restore = (store: Store, saved: Store) => {
  if (store instanceof Map) { store.clear(); for (const [k, v] of saved as Map<string, unknown>) store.set(k, v); }
  else store.splice(0, store.length, ...(saved as unknown[]));
};

/**
 * Doble de `AdminTransactions`: si `work` lanza, restaura el contenido de los almacenes (lo guardado y la auditoría).
 * Limitación: las entidades ya cargadas se mutan en memoria al instante y `revokeAllForUser` muta sesiones; el rollback cubre lo guardado.
 */
export class InMemoryAdminTransactions implements AdminTransactions {
  constructor(private readonly base: AdminTransaction & {
    organizations: { items: Store }; locations: { items: Store }; users: { items: Store }; memberships: { items: Store };
    sessions: { items: Store }; entitlements: { items: Store }; audit: { entries: Store };
  }) {}

  async withTransaction<T>(work: (tx: AdminTransaction) => Promise<T>): Promise<T> {
    const b = this.base;
    const stores = [b.organizations.items, b.locations.items, b.users.items, b.memberships.items, b.sessions.items, b.entitlements.items, b.audit.entries];
    const saved = stores.map(snapshot);
    try {
      return await work(b);
    } catch (e) {
      stores.forEach((store, i) => restore(store, saved[i]!));
      throw e;
    }
  }
}
