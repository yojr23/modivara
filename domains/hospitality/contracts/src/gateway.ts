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
