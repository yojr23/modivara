import { newId } from '@modivara/core-contracts';
import { AppUser, Entitlement, Location, LocationMembership, Organization } from '../domain/index.js';
import type { ActorContext } from '../application/actor.js';
import {
  FakePasswordHasher,
  FakeSessionTokenService,
  InMemoryEntitlementRepository,
  InMemoryLocationRepository,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
} from './in-memory-repositories.js';

/** Contraseña que cumple la política, usada por todos los usuarios de prueba. */
export const TEST_PASSWORD = 'Secret123';

/** Fixture: plataforma `labs` y dos negocios clientes con un local cada uno. */
export class World {
  readonly organizations = new InMemoryOrganizationRepository();
  readonly locations = new InMemoryLocationRepository(this.organizations);
    readonly users = new InMemoryUserRepository();
  readonly memberships = new InMemoryMembershipRepository();
  readonly sessions = new InMemorySessionRepository();
  readonly entitlements = new InMemoryEntitlementRepository();
  readonly hasher = new FakePasswordHasher();
  readonly tokens = new FakeSessionTokenService();

  readonly platform = Organization.create({ id: newId(), slug: 'labs', name: 'Labs', isPlatform: true });
  readonly sol = Organization.create({ id: newId(), slug: 'bar-sol', name: 'Bar Sol' });
  readonly luna = Organization.create({ id: newId(), slug: 'bar-luna', name: 'Bar Luna' });
  readonly solCenter = Location.create({ id: newId(), organizationId: this.sol.id, name: 'Centro' });
  readonly lunaCenter = Location.create({ id: newId(), organizationId: this.luna.id, name: 'Centro' });

  static async create(): Promise<World> {
    const w = new World();
    for (const o of [w.platform, w.sol, w.luna]) await w.organizations.save(o);
    for (const l of [w.solCenter, w.lunaCenter]) await w.locations.save(l);
    for (const o of [w.sol, w.luna]) {
      await w.entitlements.save(Entitlement.create({ organizationId: o.id, module: 'hospitality' }));
      await w.entitlements.save(Entitlement.create({ organizationId: o.id, module: 'commerce', enabled: false }));
    }
    return w;
  }

  async addUser(org: Organization, username: string, opts: { isOwner?: boolean; roles?: string[]; location?: Location } = {}): Promise<AppUser> {
    const user = AppUser.create({
      id: newId(),
      organizationId: org.id,
      username,
      displayName: username,
      passwordHash: await this.hasher.hash(TEST_PASSWORD),
      isOwner: opts.isOwner,
      now: new Date(),
    });
    await this.users.save(user);
    if (opts.roles && opts.location) {
      await this.memberships.save(LocationMembership.create({ id: newId(), user, location: opts.location, roles: opts.roles }));
    }
    return user;
  }

  /** Contexto de actor equivalente al que produciría AuthenticateSession. */
  actorOf(user: AppUser, extra: Partial<ActorContext> = {}): ActorContext {
    const org = [this.platform, this.sol, this.luna].find((o) => o.id === user.organizationId)!;
    return {
      actorUserId: user.id,
      organizationId: user.organizationId,
      isPlatform: org.isPlatform,
      isOwner: user.isOwner,
      sessionId: newId(),
      actingOrganizationId: null,
      ...extra,
    };
  }
}
