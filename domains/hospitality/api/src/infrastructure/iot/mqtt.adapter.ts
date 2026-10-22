import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import mqtt, { type MqttClient } from 'mqtt';
import { idParamSchema } from '@modivara/core-contracts';
import { gatewayIdFromTopic, MQTT_SUBSCRIPTIONS } from '@modivara/hospitality-contracts';
import type { GatewayPressAdapter } from '../gateway-press.adapter.js';
import type { GatewayIngest } from './gateway-ingest.js';
import type { GatewayRateLimiter } from './gateway-rate-limiter.js';

/** Los mensajes reales pesan decenas de bytes; más de esto se descarta sin parsear ni tocar la base. Mosquitto lo corta antes (mosquitto.conf). */
export const MQTT_MAX_PAYLOAD_BYTES = 4096;
// OPEN: tope de manejadores en vivo; ni TECH-001 ni DATA-001 lo fijan. Amplio para un bar, acota la presión sobre la base.
export const MQTT_MAX_IN_FLIGHT = 50;

export interface MqttOptions {
  url: string;
  username: string;
  password: string;
}

/** `MQTT_URL`, `MQTT_USERNAME` y `MQTT_PASSWORD`; si falta alguno, null (el adaptador no arranca). */
export function mqttOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): MqttOptions | null {
  const { MQTT_URL: url, MQTT_USERNAME: username, MQTT_PASSWORD: password } = env;
  return url && username && password ? { url, username, password } : null;
}

/**
 * Entrada MQTT del gateway: se suscribe con el usuario `api` a los tópicos de todos los gateways, deduce el gateway del tópico
 * (la ACL del broker garantiza que cada gateway solo publica en el suyo) y entrega al mismo `GatewayIngest` que HTTP.
 * Un mensaje malo nunca tumba al cliente: se registra y se descarta.
 */
export class MqttAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MqttAdapter');
  private client: MqttClient | null = null;

  constructor(
    private readonly options: MqttOptions | null,
    private readonly gateways: GatewayPressAdapter,
    private readonly ingest: GatewayIngest,
    private readonly limiter: GatewayRateLimiter,
  ) {}
  private inFlight = 0;
  private lastOverloadLog = 0;

  onModuleInit(): void {
    if (!this.options) {
      this.logger.warn('MQTT desactivado: faltan MQTT_URL, MQTT_USERNAME o MQTT_PASSWORD');
      return;
    }
    const { url, username, password } = this.options;
    // Sesión limpia: tras reconectar se vuelve a suscribir (`resubscribe` por defecto). QoS 1 en la suscripción.
    const client = mqtt.connect(url, { username, password, reconnectPeriod: 2_000, connectTimeout: 5_000 });
    this.client = client;
    client.on('connect', () => {
      this.logger.log('Conectado al broker MQTT');
      client.subscribe([MQTT_SUBSCRIPTIONS.press, MQTT_SUBSCRIPTIONS.heartbeat], { qos: 1 }, (err) => {
        if (err) this.logger.error(`No se pudo suscribir: ${err.message}`);
      });
    });
    client.on('close', () => this.logger.warn('Conexión MQTT cerrada; se reintenta automáticamente'));
    client.on('error', (err) => this.logger.error(`Error MQTT: ${err.message}`));
    client.on('message', (topic, payload) => void this.handle(topic, payload));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.endAsync(true);
    this.client = null;
  }

  /** Público para pruebas sin broker. */
  async handle(topic: string, payload: Buffer): Promise<void> {
    if (payload.length > MQTT_MAX_PAYLOAD_BYTES) {
      this.logger.warn(`Mensaje MQTT de ${payload.length} bytes (${topic}): descartado por tamaño`);
      return;
    }
    if (this.inFlight >= MQTT_MAX_IN_FLIGHT) {
      if (Date.now() - this.lastOverloadLog > 60_000) {
        this.lastOverloadLog = Date.now();
        this.logger.warn(`Más de ${MQTT_MAX_IN_FLIGHT} mensajes MQTT en proceso: se descartan los que sobran`);
      }
      return;
    }
    this.inFlight++;
    try {
      const parsed = gatewayIdFromTopic(topic);
      if (!parsed || !idParamSchema.safeParse(parsed.gatewayId).success) return;
      const decision = this.limiter.tryAcquire(parsed.gatewayId);
      if (decision !== 'allow') {
        if (decision === 'deny_first') this.logger.warn(`Gateway ${parsed.gatewayId} supera el límite de mensajes: se descartan`);
        return;
      }
      const gateway = await this.gateways.findActive(parsed.gatewayId);
      if (!gateway) {
        this.logger.warn(`Mensaje de un gateway inexistente o inactivo (${parsed.gatewayId}): descartado`);
        return;
      }
      const body: unknown = JSON.parse(payload.toString('utf8'));
      if (parsed.kind === 'press') await this.ingest.press(gateway, body, 'mqtt');
      else await this.ingest.heartbeat(gateway, body);
    } catch (e) {
      this.logger.warn(`Mensaje MQTT descartado (${topic}): ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.inFlight--;
    }
  }
}
