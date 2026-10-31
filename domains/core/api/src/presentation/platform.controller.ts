import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { CORE_API_PATHS, actingOrganizationRequestSchema, type PlatformOrganizationsResponse } from '@modivara/core-contracts';
import { ListOrganizations, SelectActingOrganization, type ActorContext } from '../application/index.js';
import { CurrentActor, RequirePermission } from './guards/decorators.js';
import { parseWith } from './http.js';

/** Operaciones de plataforma (solo superadmin: los `platform.*` los tiene únicamente la organización de plataforma). */
@Controller()
export class PlatformController {
  constructor(
    @Inject(SelectActingOrganization) private readonly select: SelectActingOrganization,
    @Inject(ListOrganizations) private readonly listOrganizations: ListOrganizations,
  ) {}

  /** Para que la consola elija negocio y local (solo lectura, sin paginar). */
  @Get(CORE_API_PATHS.platformOrganizations)
  @RequirePermission('platform.organizations.manage')
  async organizations(@CurrentActor() actor: ActorContext): Promise<PlatformOrganizationsResponse> {
    return {
      organizations: (await this.listOrganizations.execute({ actor })).map(({ organization: o, locations }) => ({
        id: o.id, slug: o.slug, name: o.name, active: o.isActive,
        locations: locations.map((l) => ({ id: l.id, name: l.name, timezone: l.timezone, active: l.isActive })),
      })),
    };
  }

  /** «Operar sobre el negocio X» (ADR-002 D3): queda en la sesión y auditado con el usuario del superadmin. */
  @Put(CORE_API_PATHS.actingOrganization)
  @RequirePermission('platform.organizations.manage')
  async actAs(@CurrentActor() actor: ActorContext, @Body() body: unknown): Promise<{ acting_organization_id: string | null }> {
    const input = parseWith(actingOrganizationRequestSchema, body);
    const updated = await this.select.execute({ actor, organizationId: input.organization_id });
    return { acting_organization_id: updated.actingOrganizationId };
  }
}
