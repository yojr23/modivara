import { gatewayHeartbeatMessageSchema, type Transport } from '@modivara/hospitality-contracts';
import type { IoTInputPort, PressOutcome } from '../../application/ports/index.js';
import type { RecordHeartbeat } from '../../application/gateways.js';
import type { Gateway } from '../../domain/devices/gateway.js';
import { ValidationError } from '../../domain/errors.js';
import type { GatewayPressAdapter } from '../gateway-press.adapter.js';

/**
 * Lo que comparten HTTP y MQTT una vez identificado el gateway: validar el mensaje y entregarlo al `IoTInputPort`.
 * Así el mismo mensaje produce el mismo resultado por cualquier canal.
 */
export class GatewayIngest {
  constructor(
    private readonly adapter: GatewayPressAdapter,
    private readonly iot: IoTInputPort,
    private readonly heartbeats: RecordHeartbeat,
  ) {}

  async press(gateway: Gateway, raw: unknown, transport: Transport): Promise<PressOutcome> {
    return this.iot.registerPress(await this.adapter.toPress(gateway, raw, transport));
  }

  async heartbeat(gateway: Gateway, raw: unknown): Promise<void> {
    const parsed = gatewayHeartbeatMessageSchema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`Invalid heartbeat message: ${parsed.error.message}`);
    await this.heartbeats.execute({ organizationId: gateway.organizationId, locationId: gateway.locationId, gatewayId: gateway.id });
  }
}
