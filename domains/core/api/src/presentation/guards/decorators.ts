import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { IS_PUBLIC_KEY, REQUEST_ACTOR_KEY, REQUIRED_MODULE_KEY, REQUIRED_PERMISSION_KEY, type ModuleName, type Permission } from '@modivara/core-contracts';
import type { ActorContext } from '../../application/index.js';
import type { HttpRequest } from '../http.js';

/** Ruta sin sesión (login, health, o con autenticación propia como la clave del gateway). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const RequirePermission = (permission: Permission) => SetMetadata(REQUIRED_PERMISSION_KEY, permission);
export const RequireModule = (module: ModuleName) => SetMetadata(REQUIRED_MODULE_KEY, module);

/** El actor autenticado de la petición (lo deja `SessionGuard`). */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): ActorContext => {
  const actor = context.switchToHttp().getRequest<HttpRequest>()[REQUEST_ACTOR_KEY];
  if (!actor) throw new Error('CurrentActor used on a route without SessionGuard');
  return actor;
});

/** Metadato del handler, o del controlador si el handler no lo define. Sin depender de `Reflector` de @nestjs/core. */
export function metadataOf<T>(key: string, context: ExecutionContext): T | undefined {
  return (Reflect.getMetadata(key, context.getHandler()) ?? Reflect.getMetadata(key, context.getClass())) as T | undefined;
}
