import { z } from 'zod';

/** Pulsación que envía el gateway por HTTP o MQTT. El tenant nunca viaja en el mensaje (DATA-001 §3). */
export const gatewayPressMessageSchema = z.object({
  device_code: z.string().min(1),
  button_key: z.string().min(1).optional(),
  /** Reloj del gateway: no confiable, solo informativo. */
  sent_at: z.iso.datetime({ offset: true }).optional(),
});
export type GatewayPressMessage = z.infer<typeof gatewayPressMessageSchema>;

/** Señal de vida del gateway. */
export const gatewayHeartbeatMessageSchema = z.object({
  sent_at: z.iso.datetime({ offset: true }).optional(),
});
export type GatewayHeartbeatMessage = z.infer<typeof gatewayHeartbeatMessageSchema>;

export const GATEWAY_HEARTBEAT_INTERVAL_MS = 30_000;
/** Sin señal por más de este tiempo, el tablero muestra "Botones desconectados" (TECH-001 §16.5). */
export const GATEWAY_DISCONNECTED_AFTER_MS = 90_000;

/** Header con la clave del gateway en `POST /device-events` y `/gateways/heartbeat`. OPEN: nombre (TECH-001 §7 no lo fija). */
export const GATEWAY_KEY_HEADER = 'x-gateway-key';

/** Ingesta HTTP del gateway bajo `/api/v1` (TECH-001 §7). El tenant sale SIEMPRE de la clave, nunca del cuerpo. */
export const GATEWAY_API_PATHS = {
  deviceEvents: '/device-events',
  heartbeat: '/gateways/heartbeat',
} as const;

/** Tópicos MQTT por gateway (DATA-001 §3): el usuario del broker es el id del gateway. */
export const mqttTopic = (gatewayId: string, kind: 'press' | 'heartbeat') => `modivara/gw/${gatewayId}/${kind}`;
export const MQTT_SUBSCRIPTIONS = { press: 'modivara/gw/+/press', heartbeat: 'modivara/gw/+/heartbeat' } as const;
/** Extrae el id del gateway de un tópico `modivara/gw/<id>/<kind>`; null si no cumple el formato. */
export function gatewayIdFromTopic(topic: string): { gatewayId: string; kind: 'press' | 'heartbeat' } | null {
  const m = /^modivara\/gw\/([^/]+)\/(press|heartbeat)$/.exec(topic);
  return m ? { gatewayId: m[1]!, kind: m[2] as 'press' | 'heartbeat' } : null;
}
