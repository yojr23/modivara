import type { CoreAccessPort } from '@modivara/core-contracts';
import type { CallStatus, CallType } from '@modivara/hospitality-contracts';
import { canSeeCall } from '../domain/service-calls/visibility.js';
import { type PermittedContext, requireActiveLocation, scopeOf } from './support.js';
import type { DiningTableRepository, LocationSettingsRepository, ServiceCallRepository, ZoneRepository } from './ports/index.js';

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
    private readonly core: CoreAccessPort,
    private readonly calls: ServiceCallRepository,
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
    private readonly settings: LocationSettingsRepository,
  ) {}

  async execute(input: PermittedContext): Promise<ActiveCallView[]> {
    await requireActiveLocation(this.core, input);
    const { callVisibility } = await this.settings.get(scopeOf(input));
    const visible = (await this.calls.listActive(scopeOf(input))).filter((c) => canSeeCall(input, c, callVisibility));
    if (visible.length === 0) return [];
    const tables = new Map((await this.tables.listByLocation(scopeOf(input))).map((t) => [t.id, t]));
    const zones = new Map((await this.zones.listByLocation(scopeOf(input))).map((z) => [z.id, z]));
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
