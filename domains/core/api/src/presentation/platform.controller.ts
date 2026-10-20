import { Body, Controller, Inject, Put } from '@nestjs/common';
import { CORE_API_PATHS, actingOrganizationRequestSchema } from '@modivara/core-contracts';
import { SelectActingOrganization, type ActorContext } from '../application/index.js';
import { CurrentActor, RequirePermission } from './guards/decorators.js';
import { parseWith } from './http.js';

/** Operaciones de plataforma (solo superadmin: los `platform.*` los tiene únicamente la organización de plataforma). */
@Controller()
export class PlatformController {
  constructor(@Inject(SelectActingOrganization) private readonly select: SelectActingOrganization) {}

  /** «Operar sobre el negocio X» (ADR-002 D3): queda en la sesión y auditado con el usuario del superadmin. */
  @Put(CORE_API_PATHS.actingOrganization)
  @RequirePermission('platform.organizations.manage')
  async actAs(@CurrentActor() actor: ActorContext, @Body() body: unknown): Promise<{ acting_organization_id: string | null }> {
    const input = parseWith(actingOrganizationRequestSchema, body);
    const updated = await this.select.execute({ actor, organizationId: input.organization_id });
    return { acting_organization_id: updated.actingOrganizationId };
  }
}
