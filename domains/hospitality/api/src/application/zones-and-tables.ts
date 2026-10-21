import type { CoreAccessPort } from '@modivara/core-contracts';
import { ConflictError, DuplicateError, NotFoundError, TableInUseError } from '../domain/errors.js';
import { DiningTable } from '../domain/tables/dining-table.js';
import { Zone } from '../domain/tables/zone.js';
import type { DeviceAssignmentRepository, DiningTableRepository, ZoneRepository } from './ports/index.js';
import { type ActorContext, requireActiveLocation, owned, scopeOf, type TenantContext } from './support.js';

export class CreateZone {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
  ) {}

  async execute(input: ActorContext & { name: string; position?: number }): Promise<Zone> {
    await requireActiveLocation(this.core, input);
    const zone = Zone.create({ ...input, createdBy: input.actorUserId, now: new Date() });
    if (await this.zones.findActiveByName({ ...scopeOf(input), name: zone.name })) throw new DuplicateError('zone');
    await this.zones.save(zone);
    return zone;
  }
}

export class CreateTable {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  async execute(input: ActorContext & { label: string; zoneId?: string | null; position?: number }): Promise<DiningTable> {
    await requireActiveLocation(this.core, input);
    if (input.zoneId) {
      const zone = owned(await this.zones.findById({ ...scopeOf(input), id: input.zoneId }), input, 'zone');
      if (!zone.isActive) throw new NotFoundError('zone');
    }
    const table = DiningTable.create({ ...input, createdBy: input.actorUserId, now: new Date() });
    // El mismo número puede repetirse en zonas distintas, no dentro de la misma (ni dos "sin zona").
    if (await this.tables.findActiveByLabel({ ...scopeOf(input), zoneId: table.zoneId, label: table.label })) throw new DuplicateError('table');
    await this.tables.save(table);
    return table;
  }
}

export class UpdateTable {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  /** `zoneId: null` la deja sin zona; `undefined` no la toca. */
  async execute(input: ActorContext & { tableId: string; label?: string; zoneId?: string | null; position?: number }): Promise<DiningTable> {
    await requireActiveLocation(this.core, input);
    const table = owned(await this.tables.findById({ ...scopeOf(input), id: input.tableId }), input, 'table');
    if (!table.isActive) throw new NotFoundError('table');
    if (input.zoneId) {
      const zone = owned(await this.zones.findById({ ...scopeOf(input), id: input.zoneId }), input, 'zone');
      if (!zone.isActive) throw new NotFoundError('zone');
    }
    table.update(
      { ...(input.label !== undefined && { label: input.label }), ...(input.zoneId !== undefined && { zoneId: input.zoneId }), ...(input.position !== undefined && { position: input.position }) },
      input.actorUserId,
      new Date(),
    );
    const same = await this.tables.findActiveByLabel({ ...scopeOf(input), zoneId: table.zoneId, label: table.label });
    if (same && same.id !== table.id) throw new DuplicateError('table');
    await this.tables.save(table);
    return table;
  }
}

export interface TableView {
  table: DiningTable;
  zoneName: string | null;
}

/** Mesas activas con el nombre de su zona; `tableId` acota a una sola (para responder tras crear o editar). */
export class ListTables {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  async execute(input: TenantContext & { tableId?: string }): Promise<TableView[]> {
    await requireActiveLocation(this.core, input);
    const zoneNames = new Map((await this.zones.listByLocation(scopeOf(input))).map((z) => [z.id, z.name]));
    return (await this.tables.listByLocation(scopeOf(input)))
      .filter((t) => t.isActive && (input.tableId === undefined || t.id === input.tableId))
      .map((table) => ({ table, zoneName: table.zoneId ? (zoneNames.get(table.zoneId) ?? null) : null }));
  }
}

export class ListZones {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
  ) {}

  async execute(input: TenantContext): Promise<Zone[]> {
    await requireActiveLocation(this.core, input);
    return (await this.zones.listByLocation(scopeOf(input))).filter((z) => z.isActive);
  }
}

export class UpdateZone {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
  ) {}

  async execute(input: ActorContext & { zoneId: string; name?: string; position?: number }): Promise<Zone> {
    await requireActiveLocation(this.core, input);
    const zone = owned(await this.zones.findById({ ...scopeOf(input), id: input.zoneId }), input, 'zone');
    if (!zone.isActive) throw new NotFoundError('zone');
    zone.update({ ...(input.name !== undefined && { name: input.name }), ...(input.position !== undefined && { position: input.position }) });
    const same = await this.zones.findActiveByName({ ...scopeOf(input), name: zone.name });
    if (same && same.id !== zone.id) throw new DuplicateError('zone');
    await this.zones.save(zone);
    return zone;
  }
}

export class DeactivateZone {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  async execute(input: ActorContext & { zoneId: string }): Promise<void> {
    await requireActiveLocation(this.core, input);
    const zone = owned(await this.zones.findById({ ...scopeOf(input), id: input.zoneId }), input, 'zone');
    if (!zone.isActive) throw new NotFoundError('zone');
    // OPEN: ¿qué pasa con las mesas de una zona que se desactiva (pasan a "sin zona", se desactivan, o se impide)? Se impide: es lo más fácil de relajar.
    if ((await this.tables.listByLocation(scopeOf(input))).some((t) => t.isActive && t.zoneId === zone.id)) {
      throw new ConflictError('Zone still has active tables');
    }
    zone.deactivate(new Date());
    await this.zones.save(zone);
  }
}

export class DeactivateTable {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly tables: DiningTableRepository,
    private readonly assignments: DeviceAssignmentRepository,
  ) {}

  async execute(input: ActorContext & { tableId: string }): Promise<void> {
    await requireActiveLocation(this.core, input);
    const table = owned(await this.tables.findById({ ...scopeOf(input), id: input.tableId }), input, 'table');
    if (!table.isActive) throw new NotFoundError('table');
    // OPEN: ¿desactivar una mesa debe desasignar sus botones solos? Por ahora se exige desasignarlos antes (más fácil de relajar).
    if ((await this.assignments.listActiveByTable({ ...scopeOf(input), tableId: table.id })).length > 0) throw new TableInUseError();
    table.deactivate(input.actorUserId, new Date());
    await this.tables.save(table);
  }
}
