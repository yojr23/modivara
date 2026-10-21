import {
  gatewayHeartbeatMessageSchema,
  gatewayPressMessageSchema,
  type GatewayHeartbeatMessage,
  type GatewayPressMessage,
} from '@modivara/hospitality-contracts';
import { connect, type IClientOptions, type MqttClient } from 'mqtt';

export const TRANSPORTS = ['http', 'mqtt'] as const;
export type TransportName = (typeof TRANSPORTS)[number];

/** Canal por el que el gateway habla con la API. Mismo contrato para ambos (TECH-001 §16.6). */
export interface GatewayTransport {
  readonly name: TransportName;
  sendPress(message: GatewayPressMessage): Promise<void>;
  sendHeartbeat(message: GatewayHeartbeatMessage): Promise<void>;
}

// OPEN: nombre del header de la clave del gateway (TECH-001 §7 solo dice "clave del gateway en un header").
export const GATEWAY_KEY_HEADER = 'x-gateway-key';

export class HttpTransport implements GatewayTransport {
  readonly name = 'http';
  readonly #apiUrl: string;
  readonly #gatewayKey: string;
  readonly #fetch: typeof fetch;

  constructor(apiUrl: string, gatewayKey: string, fetchImpl: typeof fetch = fetch) {
    this.#apiUrl = apiUrl.replace(/\/$/, '');
    this.#gatewayKey = gatewayKey;
    this.#fetch = fetchImpl;
  }

  sendPress(message: GatewayPressMessage) {
    return this.#post('/device-events', gatewayPressMessageSchema.parse(message));
  }

  sendHeartbeat(message: GatewayHeartbeatMessage) {
    return this.#post('/gateways/heartbeat', gatewayHeartbeatMessageSchema.parse(message));
  }

  async #post(path: string, body: unknown) {
    const res = await this.#fetch(`${this.#apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [GATEWAY_KEY_HEADER]: this.#gatewayKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`API respondió ${res.status}`);
  }
}

/** Tópicos por gateway (DATA-001 §3); el broker solo deja publicar en los propios (ACL). */
export const mqttTopic = (gatewayId: string, kind: 'press' | 'heartbeat') => `modivara/gw/${gatewayId}/${kind}`;

export class MqttTransport implements GatewayTransport {
  readonly name = 'mqtt';
  readonly #gatewayId: string;
  readonly #client: MqttClient;

  /** `connectImpl` se inyecta en pruebas para no abrir red. */
  constructor(url: string, gatewayId: string, password: string, connectImpl: (url: string, opts: IClientOptions) => MqttClient = connect) {
    this.#gatewayId = gatewayId;
    // El usuario del broker es el id del gateway (DATA-001 §3).
    this.#client = connectImpl(url, { username: gatewayId, password, reconnectPeriod: 5_000, connectTimeout: 5_000 });
  }

  sendPress(message: GatewayPressMessage) {
    return this.#publish('press', gatewayPressMessageSchema.parse(message));
  }

  sendHeartbeat(message: GatewayHeartbeatMessage) {
    return this.#publish('heartbeat', gatewayHeartbeatMessageSchema.parse(message));
  }

  async #publish(kind: 'press' | 'heartbeat', body: unknown) {
    if (!this.#client.connected) throw new Error('Sin conexión con el broker MQTT');
    await this.#client.publishAsync(mqttTopic(this.#gatewayId, kind), JSON.stringify(body), { qos: 1 });
  }
}
