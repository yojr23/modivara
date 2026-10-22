import { NotFoundError, type CoreAccessPort, type LocationRef, type ModuleName, type Permission, type RequestActor } from '@modivara/core-contracts';
import { SessionInvalidError } from '../domain/index.js';
import type { AuthenticateSession } from './authenticate-session.js';
import { isLocationAvailable } from './location-availability.js';
import type { EntitlementRepository, LocationRepository } from './ports/index.js';
import type { ResolveLocationAccess } from './resolve-location-access.js';

/** Implementación en proceso de `CoreAccessPort`; al separar repositorios se reemplaza por un cliente HTTP. */
export class CoreAccessService implements CoreAccessPort {
  constructor(
    private readonly locations: LocationRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly authenticate: Pick<AuthenticateSession, 'execute'>,
    private readonly access: Pick<ResolveLocationAccess, 'execute'>,
  ) {}

  async isModuleEnabled(organizationId: string, module: ModuleName): Promise<boolean> {
    return (await this.entitlements.find({ organizationId, module }))?.enabled === true;
  }

  async getLocation(locationId: string): Promise<LocationRef | null> {
    const found = await this.locations.findByIdWithOrganization({ id: locationId });
    if (!found) return null;
    const { location } = found;
    return { id: location.id, organizationId: location.organizationId, timezone: location.timezone, active: isLocationAvailable(found) };
  }

  async authenticateSession(token: string): Promise<RequestActor | null> {
    try {
      return await this.authenticate.execute({ token });
    } catch (e) {
      if (e instanceof SessionInvalidError) return null;
      throw e;
    }
  }

  async permissionsAt(actor: RequestActor, locationId: string, module?: ModuleName): Promise<ReadonlySet<Permission> | null> {
    try {
      const access = await this.access.execute({ actor, locationId });
      if (module && !actor.isPlatform && !access.modules.includes(module)) return null;
      return access.permissions;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }
}
