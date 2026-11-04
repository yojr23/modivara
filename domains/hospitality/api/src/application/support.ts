import { type CoreAccessPort, type DomainEvent, findActiveLocation, newId, type Permission } from '@modivara/core-contracts';
import type { PlatformAction } from '@modivara/hospitality-contracts';
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

export interface FailureLog {
  error(message: string): void;
}

/** Línea JSON sin secretos: solo ids y el mensaje del error. */
export function logRealtimeFailure(log: FailureLog, event: string, ctx: TenantContext, resourceId: string, error: unknown): void {
  log.error(JSON.stringify({
    event, organization_id: ctx.organizationId, location_id: ctx.locationId, resource_id: resourceId,
    error: error instanceof Error ? error.message : String(error),
  }));
}

/**
 * El guardado ya se confirmó: un fallo del aviso no debe convertirse en error para quien actuó, pero queda registrado.
 * El tablero converge solo: al (re)conectar el cliente pide el snapshot de solicitudes activas (REST) y las vuelve a leer.
 */
export async function notifyAfterSave(notifications: NotificationPort, change: CallChange, call: ServiceCall, log: FailureLog = console): Promise<void> {
  try {
    await notifications.callChanged(change, call);
  } catch (e) {
    logRealtimeFailure(log, `realtime.service_call.${change}.notify_failed`, call, call.id, e);
  }
}

/** Evento de auditoría de una acción del superadmin; el repositorio lo guarda en el outbox junto al cambio (core lo vuelca en `audit_log`). */
export function platformAction(ctx: ActorContext, action: PlatformAction, targetId: string, details: Record<string, unknown>): DomainEvent {
  return {
    eventId: newId(), eventType: 'hospitality.platform_action.recorded', eventVersion: 1, occurredAt: new Date(),
    organizationId: ctx.organizationId, locationId: ctx.locationId, aggregateId: targetId, correlationId: newId(), causationId: null,
    payload: { action, actor_user_id: ctx.actorUserId, target_type: action.split('.')[0], target_id: targetId, details },
  };
}
