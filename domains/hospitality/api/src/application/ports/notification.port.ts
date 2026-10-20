import type { ServiceCall } from '../../domain/service-calls/service-call.js';

export type CallChange = 'created' | 'repeat_press' | 'acknowledged' | 'completed';

/** Aviso al tablero (Socket.IO a la sala del local). Se invoca solo después de guardar. */
export interface NotificationPort {
  callChanged(change: CallChange, call: ServiceCall): Promise<void>;
}
