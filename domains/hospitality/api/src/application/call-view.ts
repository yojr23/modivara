import type { ServiceCallDto } from '@modivara/hospitality-contracts';
import type { ServiceCall } from '../domain/service-calls/service-call.js';
import type { DiningTableRepository, ZoneRepository } from './ports/index.js';
import { type TenantContext, scopeOf } from './support.js';

/** Llamado en la forma del contrato de la API y del tiempo real (`ServiceCallDto`). Único lugar donde se mapea. */
export function toServiceCallDto(call: ServiceCall, tableDisplayName: string): ServiceCallDto {
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
    completed_at: iso(call.completedAt),
    completed_by: call.completedBy,
  };
}

/** Arma los DTO de llamados resolviendo "Zona · Mesa" (una lectura de mesas y zonas por lote, sin N+1). */
export class CallViews {
  constructor(
    private readonly tables: DiningTableRepository,
    private readonly zones: ZoneRepository,
  ) {}

  /** Los llamados deben ser del mismo local (`scope`). */
  async many(scope: TenantContext, calls: readonly ServiceCall[]): Promise<ServiceCallDto[]> {
    if (calls.length === 0) return [];
    const tables = new Map((await this.tables.listByLocation(scopeOf(scope))).map((t) => [t.id, t]));
    const zones = new Map((await this.zones.listByLocation(scopeOf(scope))).map((z) => [z.id, z]));
    return calls.map((c) => {
      const table = tables.get(c.tableId);
      const zoneName = table?.zoneId ? (zones.get(table.zoneId)?.name ?? null) : null;
      return toServiceCallDto(c, table?.displayName(zoneName) ?? c.tableId);
    });
  }

  async one(call: ServiceCall): Promise<ServiceCallDto> {
    return (await this.many(call, [call]))[0]!;
  }
}
