import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { GATEWAY_KEY_HEADER } from '@modivara/hospitality-contracts';
import type { Gateway } from '../domain/devices/gateway.js';
import { GatewayPressAdapter, InvalidGatewayKeyError } from '../infrastructure/gateway-press.adapter.js';

const GATEWAY_KEY = 'hospitalityGateway';

/**
 * Las rutas del gateway no usan sesión de usuario (van marcadas como públicas): se autentican solo con la clave del gateway.
 * Clave ausente, desconocida o de un gateway desactivado -> 401 con el mismo mensaje.
 */
@Injectable()
export class GatewayKeyGuard implements CanActivate {
  constructor(@Inject(GatewayPressAdapter) private readonly adapter: GatewayPressAdapter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> } & Record<string, unknown>>();
    const key = req.headers[GATEWAY_KEY_HEADER];
    if (typeof key !== 'string' || !key) throw new UnauthorizedException('Invalid gateway key');
    try {
      req[GATEWAY_KEY] = await this.adapter.authenticate(key);
    } catch (e) {
      if (e instanceof InvalidGatewayKeyError) throw new UnauthorizedException('Invalid gateway key');
      throw e;
    }
    return true;
  }
}

/** El gateway autenticado por `GatewayKeyGuard`; de él salen negocio y local. */
export const CurrentGateway = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Gateway => (context.switchToHttp().getRequest() as Record<string, Gateway>)[GATEWAY_KEY]!,
);
