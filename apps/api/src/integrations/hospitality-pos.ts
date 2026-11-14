import { CORE_ACCESS_PORT, type CoreAccessPort } from '@modivara/core-contracts';
import { ListTables } from '@modivara/hospitality-api';
import { POS_REFERENCE_VALIDATORS, type ExternalReferenceValidator, type PosContext } from '@modivara/pos-api';

/**
 * Adaptador Hospitality → POS (POS-27, POS-28): una venta se ata a una mesa activa del local del actor, solo si el negocio tiene
 * Hospitality. Vive en el host: POS no conoce mesas y Hospitality no conoce ventas. Devuelve el nombre de la mesa tal como lo muestra
 * el tablero (p. ej. «Mesa 3»). Mesa inexistente, inactiva, de otro local o negocio sin el módulo → null, que POS responde como 404.
 */
export class HospitalityTableValidator implements ExternalReferenceValidator {
  readonly provider = 'hospitality';

  constructor(private readonly listTables: ListTables, private readonly core: CoreAccessPort) {}

  async validate(ctx: PosContext, resourceType: string, resourceId: string): Promise<string | null> {
    if (resourceType !== 'table') return null;
    if (!(await this.core.isModuleEnabled(ctx.organizationId, 'hospitality'))) return null;
    const found = await this.listTables.execute({ organizationId: ctx.organizationId, locationId: ctx.locationId, tableId: resourceId });
    return found[0]?.table.label ?? null;
  }
}

/** Proveedor del host: requiere `ListTables` (HospitalityModule) a la vista; sin Hospitality en el host no se registra. */
export const posReferenceValidators = {
  provide: POS_REFERENCE_VALIDATORS,
  inject: [ListTables, CORE_ACCESS_PORT],
  useFactory: (listTables: ListTables, core: CoreAccessPort): ExternalReferenceValidator[] => [new HospitalityTableValidator(listTables, core)],
};
