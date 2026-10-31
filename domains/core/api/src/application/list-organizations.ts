import { PermissionDeniedError, type Location, type Organization } from '../domain/index.js';
import type { ActorContext } from './actor.js';
import type { OrganizationRepository } from './ports/index.js';

export class ListOrganizations {
  constructor(private readonly organizations: OrganizationRepository) {}

  /** Negocios de clientes con sus locales (también los inactivos, marcados), para que la consola de plataforma elija sobre cuál operar. */
  async execute(input: { actor: ActorContext }): Promise<Array<{ organization: Organization; locations: Location[] }>> {
    if (!input.actor.isPlatform) throw new PermissionDeniedError('Only platform users can list organizations');
    // ponytail: sin paginación; un puñado de negocios en el MVP. Paginar por cursor de nombre si pasan de cientos.
    return this.organizations.listWithLocations();
  }
}
