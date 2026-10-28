import type { DeviceEvent } from '../../domain/devices/device-event.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';

/** Solo seeds de demo: guarda un llamado ya recorrido (con fechas pasadas), sus transiciones, eventos de outbox y señales del botón, en una transacción. */
export interface CallHistoryStore {
  save(call: ServiceCall, deviceEvents: DeviceEvent[]): Promise<void>;
}
