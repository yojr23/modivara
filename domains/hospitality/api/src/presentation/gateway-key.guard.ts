import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Inject, Injectable, Logger, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { GATEWAY_KEY_HEADER } from '@modivara/hospitality-contracts';
import type { Gateway } from '../domain/devices/gateway.js';
import { GatewayPressAdapter, InvalidGatewayKeyError } from '../infrastructure/gateway-press.adapter.js';
import { GatewayRateLimiter } from '../infrastructure/iot/gateway-rate-limiter.js';

const GATEWAY_KEY = 'hospitalityGateway';

/**
 * Las rutas del gateway no usan sesión de usuario (van marcadas como públicas): se autentican solo con la clave del gateway.
 * Clave ausente, desconocida o de un gateway desactivado -> 401 con el mismo mensaje.
 */
@Injectable()
export class GatewayKeyGuard implements CanActivate {
  private readonly logger = new Logger('GatewayKeyGuard');

  constructor(
    @Inject(GatewayPressAdapter) private readonly adapter: GatewayPressAdapter,
    @Inject(GatewayRateLimiter) private readonly limiter: GatewayRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> } & Record<string, unknown>>();
    const key = req.headers[GATEWAY_KEY_HEADER];
    if (typeof key !== 'string' || !key) throw new UnauthorizedException('Invalid gateway key');
    let gateway: Gateway;
    try {
      gateway = await this.adapter.authenticate(key);
    } catch (e) {
      if (e instanceof InvalidGatewayKeyError) throw new UnauthorizedException('Invalid gateway key');
      throw e;
    }
    // Límite compartido con MQTT, antes de validar el cuerpo y de tocar la base con el mensaje.
    const decision = this.limiter.tryAcquire(gateway.id);
    if (decision !== 'allow') {
      if (decision === 'deny_first') this.logger.warn(`Gateway ${gateway.id} supera el límite de mensajes: se responde 429`);
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    req[GATEWAY_KEY] = gateway;
    return true;
  }
}

/** El gateway autenticado por `GatewayKeyGuard`; de él salen negocio y local. */
export const CurrentGateway = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Gateway => (context.switchToHttp().getRequest() as Record<string, Gateway>)[GATEWAY_KEY]!,
);
