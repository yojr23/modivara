import type { DeviceEventRepository, Scope, UnknownDeviceCode } from '../../application/ports/index.js';
import type { HospitalityPrisma } from './client.js';

export class PrismaDeviceEventRepository implements DeviceEventRepository {
  constructor(private readonly db: HospitalityPrisma) {}

  /** Un solo GROUP BY por código con NOT EXISTS contra `devices` (sin N+1). */
  async listUnknownCodes({ organizationId, locationId, since }: Scope & { since: Date }): Promise<UnknownDeviceCode[]> {
    const rows = await this.db.$queryRaw<{ device_code: string; first_received_at: Date; last_received_at: Date; press_count: number }[]>`
      SELECT e.device_code,
             min(e.received_at) AS first_received_at,
             max(e.received_at) AS last_received_at,
             count(*)::int      AS press_count
      FROM device_events e
      WHERE e.organization_id = ${organizationId}::uuid
        AND e.location_id = ${locationId}::uuid
        AND e.result = 'unknown_device'
        AND e.received_at >= ${since}::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM devices d
          WHERE d.location_id = e.location_id AND d.code = e.device_code AND d.deactivated_at IS NULL
        )
      GROUP BY e.device_code
      ORDER BY max(e.received_at) DESC`;
    return rows.map((r) => ({ deviceCode: r.device_code, firstReceivedAt: r.first_received_at, lastReceivedAt: r.last_received_at, pressCount: r.press_count }));
  }
}
