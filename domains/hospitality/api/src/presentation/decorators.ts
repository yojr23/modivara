import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import {
  effectiveOrganizationId, idParamSchema, REQUEST_ACTOR_KEY, REQUIRED_MODULE_KEY, REQUIRED_PERMISSION_KEY, type ModuleName, type Permission,
  type RequestActor,
} from '@modivara/core-contracts';
import type { ActorContext } from '../application/support.js';

// Mismos metadatos que leen los guards globales de core; se declaran aquí para no importar core-api (ADR-002 D1).
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION_KEY, permission);
export const RequireModule = (module: ModuleName) => SetMetadata(REQUIRED_MODULE_KEY, module);

/** El actor autenticado que dejó el guard de sesión de core. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): RequestActor => {
  const actor = (context.switchToHttp().getRequest() as Record<string, RequestActor | undefined>)[REQUEST_ACTOR_KEY];
  if (!actor) throw new Error('CurrentActor used on a route without the session guard');
  return actor;
});

/** Contexto de los casos de uso: el negocio sale del actor y el local de la ruta, nunca del cuerpo. */
/** Id de ruta (zona, mesa, dispositivo) validado como UUID: un valor inválido es 400, nunca un 500 de la base. */
export const idOf = (raw: string): string => idParamSchema.parse(raw);

export const contextOf = (actor: RequestActor, locationId: string): ActorContext => ({
  organizationId: effectiveOrganizationId(actor),
  locationId: idParamSchema.parse(locationId),
  actorUserId: actor.actorUserId,
});
