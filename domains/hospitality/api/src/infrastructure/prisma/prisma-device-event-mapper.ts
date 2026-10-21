import { DeviceEvent } from '../../domain/devices/device-event.js';
import type { Prisma } from './generated/client.js';
import type { Db } from './db.js';

type Row = Awaited<ReturnType<Prisma.TransactionClient['deviceEvent']['findFirstOrThrow']>>;

export const toDeviceEvent = (r: Row) =>
  DeviceEvent.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, gatewayId: r.gatewayId, deviceId: r.deviceId,
    deviceCode: r.deviceCode, buttonKey: r.buttonKey, transport: r.transport, payload: r.payload as Record<string, unknown>,
    sentAt: r.sentAt, receivedAt: r.receivedAt, result: r.result, serviceCallId: r.serviceCallId, correlationId: r.correlationId,
  });

export async function insertDeviceEvent(db: Db, e: DeviceEvent): Promise<void> {
  const { payload, ...rest } = e.toProps();
  await db.deviceEvent.create({ data: { ...rest, payload: payload as Prisma.InputJsonValue } });
}
