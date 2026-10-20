import { type CoreAccessPort, findActiveLocation, type Permission } from '@modivara/core-contracts';
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

/** Solo el tenant: lo que acota toda consulta de un repositorio. */
export const scopeOf = ({ organizationId, locationId }: TenantContext): TenantContext => ({ organizationId, locationId });

/** Contexto común de los listados con permisos (convención de los 4 dominios). */
export interface PermittedContext extends ActorContext {
  permissions: ReadonlySet<Permission>;
}

/** El local debe existir, estar activo y pertenecer a la organización autorizada (DATA-001 §1). */
export async function requireActiveLocation(core: CoreAccessPort, ctx: TenantContext): Promise<void> {
  if (!(await findActiveLocation(core, ctx.organizationId, ctx.locationId))) throw new LocationUnavailableError();
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
