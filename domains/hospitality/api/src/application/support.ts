import type { CoreAccessPort } from '@modivara/core-contracts';
import { LocationUnavailableError, NotFoundError } from '../domain/errors.js';
import type { CallChange, NotificationPort } from './ports/notification.port.js';
import type { ServiceCall } from '../domain/service-calls/service-call.js';

export interface TenantContext {
  organizationId: string;
  locationId: string;
}

export interface ActorContext extends TenantContext {
  actorUserId: string;
}

/** El local debe existir, estar activo y pertenecer a la organización autorizada (DATA-001 §1). */
export async function assertLocation(core: CoreAccessPort, ctx: TenantContext): Promise<void> {
  const location = await core.getLocation(ctx.locationId);
  if (!location || !location.active || location.id !== ctx.locationId || location.organizationId !== ctx.organizationId) {
    throw new LocationUnavailableError(ctx.locationId);
  }
}

/**
 * Tras cargar una entidad por id: debe ser del negocio y local del actor. Si no, se trata como inexistente
 * para no revelar que existe en otro tenant.
 */
export function owned<T extends { organizationId: string; locationId: string }>(entity: T | null | undefined, ctx: TenantContext, name: string): T {
  if (!entity || entity.organizationId !== ctx.organizationId || entity.locationId !== ctx.locationId) throw new NotFoundError(name);
  return entity;
}

/** El guardado ya se confirmó: un fallo del aviso no debe convertirse en error para quien actuó. */
export async function notifyAfterSave(notifications: NotificationPort, change: CallChange, call: ServiceCall): Promise<void> {
  try {
    await notifications.callChanged(change, call);
  } catch {
    // ponytail: se ignora sin registrar (aún no hay logger); el tablero se recupera al refrescar. Agregar LoggerPort con la infraestructura real.
  }
}
