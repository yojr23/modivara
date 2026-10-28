import type { CallHistoryStore } from '../../application/ports/index.js';
import type { DeviceEvent } from '../../domain/devices/device-event.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { HospitalityPrisma } from './client.js';
import { insertDeviceEvent } from './prisma-device-event-mapper.js';
import { persistTransitionsAndOutbox } from './service-call-persistence.js';

/** Solo seeds de demo. Inserta el llamado en su estado final (fechas pasadas) y reutiliza el mismo mapeo de transiciones y outbox que la vía en vivo. */
export class PrismaCallHistoryStore implements CallHistoryStore {
  constructor(private readonly db: HospitalityPrisma) {}

  save(call: ServiceCall, deviceEvents: DeviceEvent[]) {
    return this.db.$transaction(async (tx) => {
      await tx.serviceCall.create({ data: call.toProps() });
      for (const e of deviceEvents) await insertDeviceEvent(tx, e);
      await persistTransitionsAndOutbox(tx, call);
    });
  }
}
