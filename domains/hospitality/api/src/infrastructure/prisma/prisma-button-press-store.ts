import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { DeviceEvent } from '../../domain/devices/device-event.js';
import type { ButtonPressStore, ButtonPressTx, Scope } from '../../application/ports/index.js';
import type { HospitalityPrisma } from './client.js';
import type { Prisma } from './generated/client.js';
import { insertDeviceEvent, toDeviceEvent } from './prisma-device-event-mapper.js';
import { persistTransitionsAndOutbox, toServiceCall } from './service-call-persistence.js';

class PrismaButtonPressTx implements ButtonPressTx {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async findLastPress({ organizationId, locationId, deviceId, buttonKey }: Scope & { deviceId: string; buttonKey: string | null }) {
    const r = await this.tx.deviceEvent.findFirst({
      where: { organizationId, locationId, deviceId, buttonKey, result: { in: ['call_created', 'repeat_press'] } },
      orderBy: { receivedAt: 'desc' },
    });
    return r && toDeviceEvent(r);
  }

  /** DATA-001 §3: una sola sentencia atómica; `xmax = 0` distingue la fila insertada de la actualizada. */
  async upsertActiveCall(candidate: ServiceCall, now: Date) {
    const c = candidate.toProps();
    const [row] = await this.tx.$queryRaw<{ id: string; created: boolean }[]>`
      INSERT INTO service_calls (id, organization_id, location_id, table_id, call_type, status, press_count, created_at, last_press_at, updated_at)
      VALUES (${c.id}::uuid, ${c.organizationId}::uuid, ${c.locationId}::uuid, ${c.tableId}::uuid, ${c.callType}::call_type, 'pending', 1,
              ${c.createdAt}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
      ON CONFLICT (table_id, call_type) WHERE status IN ('pending', 'in_progress')
      DO UPDATE SET press_count = service_calls.press_count + 1, last_press_at = ${now}::timestamptz, updated_at = ${now}::timestamptz
      RETURNING id, (xmax = 0) AS created`;
    if (!row) throw new Error('upsert of service call returned no row');
    if (row.created) {
      await persistTransitionsAndOutbox(this.tx, candidate);
      return { call: candidate, created: true };
    }
    // Existía: el candidato se descarta (sin transición ni evento) y se devuelve el llamado vigente.
    const existing = await this.tx.serviceCall.findUniqueOrThrow({ where: { id: row.id } });
    return { call: toServiceCall(existing), created: false };
  }

  saveDeviceEvent(event: DeviceEvent) {
    return insertDeviceEvent(this.tx, event);
  }
}

export class PrismaButtonPressStore implements ButtonPressStore {
  constructor(private readonly db: HospitalityPrisma) {}

  /** Transacción + `pg_advisory_xact_lock` por dispositivo: serializa las señales simultáneas del mismo botón. */
  withDeviceLock<T>(deviceId: string, work: (tx: ButtonPressTx) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${deviceId}::text))`;
      return work(new PrismaButtonPressTx(tx));
    });
  }

  saveDeviceEvent(event: DeviceEvent) {
    return insertDeviceEvent(this.db, event);
  }
}
