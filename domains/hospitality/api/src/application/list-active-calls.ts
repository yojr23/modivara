import type { CallStatus, CallType, CallVisibility } from '@modivara/hospitality-contracts';
import { canSeeCall, type Viewer } from '../domain/service-calls/visibility.js';
import type { DiningTableRepository, ServiceCallRepository, ZoneRepository } from './ports/index.js';

export interface ActiveCallView {
  id: string;
  tableId: string;
  /** "Zona · Mesa" o solo la mesa. */
  tableName: string;
  callType: CallType;
  status: CallStatus;
  pressCount: number;
  createdAt: Date;
  lastPressAt: Date;
  acknowledgedAt: Date | null;
}

export class ListActiveCalls {
  constructor(
    private readonly calls: ServiceCallRepository,
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
  ) {}

  // OPEN: la visibilidad vive en location_settings (DATA-001 §3) y aún no hay puerto para leerla; hoy es siempre 'all'.
  async execute(input: { viewer: Viewer; visibility?: CallVisibility }): Promise<ActiveCallView[]> {
    const { viewer } = input;
    const visible = (await this.calls.listActive(viewer.locationId)).filter((c) => canSeeCall(viewer, c, input.visibility ?? 'all'));
    if (visible.length === 0) return [];
    const tables = new Map((await this.tables.listByLocation(viewer.locationId)).map((t) => [t.id, t]));
    const zones = new Map((await this.zones.listByLocation(viewer.locationId)).map((z) => [z.id, z]));
    return visible
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((c) => {
        const table = tables.get(c.tableId);
        const zoneName = table?.zoneId ? (zones.get(table.zoneId)?.name ?? null) : null;
        return {
          id: c.id,
          tableId: c.tableId,
          tableName: table?.displayName(zoneName) ?? c.tableId,
          callType: c.callType,
          status: c.status,
          pressCount: c.pressCount,
          createdAt: c.createdAt,
          lastPressAt: c.lastPressAt,
          acknowledgedAt: c.acknowledgedAt,
        };
      });
  }
}
