import { type CallType, gatewayPressMessageSchema, type Transport } from '@modivara/hospitality-contracts';
import type { GatewayRepository, NormalizedPress } from '../application/ports/index.js';
import { Gateway } from '../domain/devices/gateway.js';
import { DomainError, ValidationError } from '../domain/errors.js';

export class InvalidGatewayKeyError extends DomainError {
  readonly code = 'invalid_gateway_key';
  constructor() {
    super('Unknown or inactive gateway key');
  }
}

export type KeyMap = Readonly<Record<string, CallType>>;

/**
 * Traducción tecla → call_type (ADR-002 D4): vive aquí, no en el dominio.
 * Un mapa por modelo de botón; sin mapa o sin tecla, `attention`.
 */
export class ButtonSignalTranslator {
  constructor(private readonly mapsByModel: Readonly<Record<string, KeyMap>> = {}) {}

  translate(model: string | null, buttonKey: string | null): CallType {
    return (model && buttonKey ? this.mapsByModel[model]?.[buttonKey] : undefined) ?? 'attention';
  }
}

/**
 * Adaptador de entrada del gateway (HTTP o MQTT): autentica, valida el mensaje y produce la pulsación normalizada.
 * El tenant sale del gateway autenticado, nunca del mensaje (DATA-001 §3).
 */
export class GatewayPressAdapter {
  constructor(
    private readonly gateways: GatewayRepository,
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
    return {
      gatewayId: gateway.id,
      organizationId: gateway.organizationId,
      locationId: gateway.locationId,
      deviceCode: device_code,
      buttonKey: button_key ?? null,
      // OPEN: el modelo del botón solo se conoce tras buscar el dispositivo; ¿el adaptador lo consulta o el caso de uso recibe la tecla cruda? Hoy no se pasa modelo.
      callType: this.translator.translate(null, button_key ?? null),
      sentAt: sent_at ? new Date(sent_at) : null,
      transport,
      payload: parsed.data,
    };
  }
}
