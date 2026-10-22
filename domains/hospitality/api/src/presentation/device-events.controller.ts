import { Body, Controller, HttpCode, Inject, Post, SetMetadata, UseGuards } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '@modivara/core-contracts';
import { GATEWAY_API_PATHS as P } from '@modivara/hospitality-contracts';
import type { Gateway } from '../domain/devices/gateway.js';
import { GatewayIngest } from '../infrastructure/iot/gateway-ingest.js';
import { CurrentGateway, GatewayKeyGuard } from './gateway-key.guard.js';

/**
 * Entrada HTTP del gateway (TECH-001 §7). Públicas para la sesión de usuario; las protege `GatewayKeyGuard`.
 * Organización, local y gateway salen de la clave: lo que el cuerpo diga de ellos se descarta al validar (el esquema no los declara).
 * Tamaño del cuerpo: el límite por defecto de Express (100 kB) sobra para estos mensajes de decenas de bytes.
 */
@Controller()
@SetMetadata(IS_PUBLIC_KEY, true)
@UseGuards(GatewayKeyGuard)
export class DeviceEventsController {
  constructor(@Inject(GatewayIngest) private readonly ingest: GatewayIngest) {}

  @Post(P.deviceEvents)
  @HttpCode(200)
  async press(@CurrentGateway() gateway: Gateway, @Body() body: unknown): Promise<{ result: string; device_event_id: string; service_call_id: string | null }> {
    const out = await this.ingest.press(gateway, body, 'http');
    return { result: out.result, device_event_id: out.deviceEventId, service_call_id: out.serviceCallId };
  }

  @Post(P.heartbeat)
  @HttpCode(204)
  async heartbeat(@CurrentGateway() gateway: Gateway, @Body() body: unknown): Promise<void> {
    await this.ingest.heartbeat(gateway, body);
  }
}
