import type { CoreAccessPort } from '@modivara/core-contracts';
import { DuplicateError, NotFoundError, TableInUseError } from '../domain/errors.js';
import { DiningTable } from '../domain/tables/dining-table.js';
import { Zone } from '../domain/tables/zone.js';
import type { DeviceAssignmentRepository, DiningTableRepository, ZoneRepository } from './ports/index.js';
import { type ActorContext, requireActiveLocation, owned, scopeOf } from './support.js';

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

export class RenameTable {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly tables: DiningTableRepository,
  ) {}

  async execute(input: ActorContext & { tableId: string; label: string }): Promise<DiningTable> {
    await requireActiveLocation(this.core, input);
    const table = owned(await this.tables.findById({ ...scopeOf(input), id: input.tableId }), input, 'table');
    if (!table.isActive) throw new NotFoundError('table');
    table.rename(input.label, input.actorUserId, new Date());
    const same = await this.tables.findActiveByLabel({ ...scopeOf(input), zoneId: table.zoneId, label: table.label });
    if (same && same.id !== table.id) throw new DuplicateError('table');
    await this.tables.save(table);
    return table;
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
