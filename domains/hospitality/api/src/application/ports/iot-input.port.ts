import type { CallType, DeviceEventResult, Transport } from '@modivara/hospitality-contracts';

/** Pulsación ya normalizada por el adaptador (HTTP o MQTT). El tenant lo resolvió el adaptador, nunca el mensaje. */
export interface NormalizedPress {
  gatewayId: string;
  organizationId: string;
  locationId: string;
  deviceCode: string;
  buttonKey: string | null;
  /** Ya traducido por el adaptador (tecla → tipo). */
  callType: CallType;
  /** Reloj del gateway: informativo. */
  sentAt: Date | null;
  transport: Transport;
  /** Mensaje original completo, para el registro. */
  payload: Record<string, unknown>;
  /** Clave de idempotencia del gateway (PAT-03); sin ella solo protege el debounce. */
  pressId?: string;
  /** Nace en la ingesta (QA-05); si falta, el caso de uso genera uno. */
  correlationId?: string;
}

export interface PressOutcome {
  result: DeviceEventResult;
  deviceEventId: string;
  serviceCallId: string | null;
}

/** Lo que llaman los adaptadores de entrada (HTTP/MQTT). */
export interface IoTInputPort {
  registerPress(press: NormalizedPress): Promise<PressOutcome>;
}
