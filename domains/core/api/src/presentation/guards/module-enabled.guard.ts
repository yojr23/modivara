import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { REQUEST_ACTOR_KEY, REQUIRED_MODULE_KEY, type ModuleName } from '@modivara/core-contracts';
import { Authorize } from '../../application/index.js';
import type { HttpRequest } from '../http.js';
import { metadataOf } from './decorators.js';

/** Verifica que el negocio tenga habilitado el módulo de `@RequireModule` (entitlements). */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(@Inject(Authorize) private readonly authorize: Authorize) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = metadataOf<ModuleName>(REQUIRED_MODULE_KEY, context);
    if (!module) return true;
    const actor = context.switchToHttp().getRequest<HttpRequest>()[REQUEST_ACTOR_KEY];
    if (!actor) throw new Error('ModuleEnabledGuard needs SessionGuard before it');
    await this.authorize.module({ actor, module });
    return true;
  }
}
