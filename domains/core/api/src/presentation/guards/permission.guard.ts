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
    const required = metadataOf<Permission | Permission[]>(REQUIRED_PERMISSION_KEY, context);
    if (!required) return true;
    const req = context.switchToHttp().getRequest<HttpRequest>();
    const actor = req[REQUEST_ACTOR_KEY];
    if (!actor) throw new Error('PermissionGuard needs SessionGuard before it');
    const raw = req.params[LOCATION_ID_PARAM];
    const locationId = raw !== undefined ? idParamSchema.parse(raw) : undefined;
    // Varios permisos = cualquiera de ellos; si ninguno vale, falla con el error del último.
    const options = [required].flat();
    for (const [i, permission] of options.entries()) {
      try {
        await this.authorize.permission({ actor, permission, ...(locationId && { locationId }) });
        return true;
      } catch (e) {
        if (i === options.length - 1) throw e;
      }
    }
    return true;
  }
}
