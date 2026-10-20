import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { LOCATION_ID_PARAM, REQUEST_ACTOR_KEY, REQUIRED_PERMISSION_KEY, idParamSchema, type Permission } from '@modivara/core-contracts';
import { Authorize } from '../../application/index.js';
import type { HttpRequest } from '../http.js';
import { metadataOf } from './decorators.js';

/** Verifica el permiso de `@RequirePermission` (nunca roles). Con `:locationId` en la ruta, en ese local. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Authorize) private readonly authorize: Authorize) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = metadataOf<Permission>(REQUIRED_PERMISSION_KEY, context);
    if (!permission) return true;
    const req = context.switchToHttp().getRequest<HttpRequest>();
    const actor = req[REQUEST_ACTOR_KEY];
    if (!actor) throw new Error('PermissionGuard needs SessionGuard before it');
    const raw = req.params[LOCATION_ID_PARAM];
    await this.authorize.permission({ actor, permission, ...(raw !== undefined && { locationId: idParamSchema.parse(raw) }) });
    return true;
  }
}
