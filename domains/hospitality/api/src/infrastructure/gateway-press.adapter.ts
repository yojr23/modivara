import { gatewayPressMessageSchema, type Transport } from '@modivara/hospitality-contracts';
import type { DeviceRepository, GatewayRepository, NormalizedPress } from '../application/ports/index.js';
import { Gateway } from '../domain/devices/gateway.js';
import { DomainError, ValidationError } from '../domain/errors.js';
import { ButtonSignalTranslator } from './iot/key-map.js';

export class InvalidGatewayKeyError extends DomainError {
  readonly code = 'invalid_gateway_key';
  constructor() {
    super('Unknown or inactive gateway key');
  }
}

/**
 * Adaptador de entrada del gateway (HTTP o MQTT): autentica, valida el mensaje y produce la pulsación normalizada.
 * El tenant sale del gateway autenticado, nunca del mensaje (DATA-001 §3).
 */
export class GatewayPressAdapter {
  constructor(
    private readonly gateways: GatewayRepository,
    private readonly devices: DeviceRepository,
    private readonly translator: ButtonSignalTranslator = new ButtonSignalTranslator(),
  ) {}

  /** Clave HTTP en claro -> gateway activo (se compara el hash SHA-256). */
  async authenticate(plainKey: string): Promise<Gateway> {
    const gateway = await this.gateways.findByKeyHash(Gateway.hashKey(plainKey));
    if (!gateway?.isActive) throw new InvalidGatewayKeyError();
    return gateway;
  }

  /** Gateway activo por el id del tópico MQTT; null si no existe o está desactivado (el mensaje se descarta). */
  async findActive(gatewayId: string): Promise<Gateway | null> {
    const gateway = await this.gateways.findByIdAnyTenant(gatewayId);
    return gateway?.isActive ? gateway : null;
  }

  async toPress(gateway: Gateway, rawMessage: unknown, transport: Transport): Promise<NormalizedPress> {
    const parsed = gatewayPressMessageSchema.safeParse(rawMessage);
    if (!parsed.success) throw new ValidationError(`Invalid press message: ${parsed.error.message}`);
    const { device_code, button_key, sent_at } = parsed.data;
    // El modelo solo hace falta para traducir la tecla: sin tecla no se consulta el dispositivo.
    const model = button_key
      ? ((await this.devices.findActiveByCode({ organizationId: gateway.organizationId, locationId: gateway.locationId, code: device_code }))?.model ?? null)
      : null;
    return {
      gatewayId: gateway.id,
      organizationId: gateway.organizationId,
      locationId: gateway.locationId,
      deviceCode: device_code,
      buttonKey: button_key ?? null,
      callType: this.translator.translate(model, button_key ?? null),
      sentAt: sent_at ? new Date(sent_at) : null,
      transport,
      payload: parsed.data,
    };
  }
}
