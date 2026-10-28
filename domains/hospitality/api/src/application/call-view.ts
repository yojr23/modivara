import type { CoreAccessPort } from '@modivara/core-contracts';
import type { ServiceCallDto } from '@modivara/hospitality-contracts';
import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { DiningTableRepository, ZoneRepository } from './ports/index.js';
import { type TenantContext, scopeOf } from './support.js';

/** Llamado en la forma del contrato de la API y del tiempo real (`ServiceCallDto`). Único lugar donde se mapea. */
export function toServiceCallDto(call: ServiceCall, tableDisplayName: string, names: ReadonlyMap<string, string> = new Map()): ServiceCallDto {
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    id: call.id,
    location_id: call.locationId,
    table_id: call.tableId,
    table_display_name: tableDisplayName,
    call_type: call.callType,
    status: call.status,
    press_count: call.pressCount,
    created_at: call.createdAt.toISOString(),
    last_press_at: call.lastPressAt.toISOString(),
    acknowledged_at: iso(call.acknowledgedAt),
    acknowledged_by: call.acknowledgedBy,
    acknowledged_by_name: (call.acknowledgedBy && names.get(call.acknowledgedBy)) || null,
    completed_at: iso(call.completedAt),
    completed_by: call.completedBy,
    completed_by_name: (call.completedBy && names.get(call.completedBy)) || null,
  };
}

/** Arma los DTO de llamados resolviendo "Zona · Mesa" (una lectura de mesas y zonas por lote, sin N+1). */
export class CallViews {
  constructor(
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
    private readonly core: CoreAccessPort,
  ) {}

  /** Los llamados deben ser del mismo local (`scope`). */
  async many(scope: TenantContext, calls: readonly ServiceCall[]): Promise<ServiceCallDto[]> {
    if (calls.length === 0) return [];
    const tables = new Map((await this.tables.listByLocation(scopeOf(scope))).map((t) => [t.id, t]));
    const zones = new Map((await this.zones.listByLocation(scopeOf(scope))).map((z) => [z.id, z]));
    // Un solo lote a core por llamada (nunca N+1).
    const names = await this.core.userDisplayNames({
      organizationId: scope.organizationId,
      userIds: [...new Set(calls.flatMap((c) => [c.acknowledgedBy, c.completedBy]).filter((id): id is string => !!id))],
    });
    return calls.map((c) => {
      const table = tables.get(c.tableId);
      const zoneName = table?.zoneId ? (zones.get(table.zoneId)?.name ?? null) : null;
      return toServiceCallDto(c, table?.displayName(zoneName) ?? c.tableId, names);
    });
  }

  async one(call: ServiceCall): Promise<ServiceCallDto> {
    return (await this.many(call, [call]))[0]!;
  }
}
