import type { CoreAccessPort } from '@modivara/core-contracts';
import { LayoutRevisionConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { type LayoutContent, SpaceLayout, validateLayoutContent } from '../domain/layouts/space-layout.js';
import type { DiningTable } from '../domain/tables/dining-table.js';
import type { DiningTableRepository, LayoutNotifier, LayoutRepository, ZoneRepository } from './ports/index.js';
import { type ActorContext, owned, requireActiveLocation, scopeOf, type TenantContext } from './support.js';

/** La zona del espacio debe ser del local y estar activa; `null` (espacio por defecto) no necesita zona. */
async function requireSpace(zones: ZoneRepository, ctx: TenantContext, zoneId: string | null): Promise<void> {
  if (zoneId === null) return;
  if (!owned(await zones.findById({ ...scopeOf(ctx), id: zoneId }), ctx, 'zone').isActive) throw new NotFoundError('zone');
}

/** Cada mesa dibujada debe existir en el local, estar activa y ser de la zona del plano (null coincide con null). */
function assertPlaceable(layout: SpaceLayout, tables: DiningTable[]): void {
  const byId = new Map(tables.map((t) => [t.id, t]));
  for (const id of layout.tableIds) {
    const table = byId.get(id);
    if (!table || !table.isActive || table.zoneId !== layout.zoneId) throw new ValidationError(`Table ${id} cannot be placed in this space`);
  }
}

/** Lectura: las mesas que ya no son colocables aquí (desactivadas o movidas de zona) se omiten; pasan a "sin ubicar". */
function visible(layout: SpaceLayout, tables: DiningTable[]): SpaceLayout {
  const here = new Set(tables.filter((t) => t.isActive && t.zoneId === layout.zoneId).map((t) => t.id));
  return layout.withElements(layout.elements.filter((e) => e.type !== 'table' || here.has(e.table_id)));
}

/** Planos publicados del local para el tablero; omite los de zonas desactivadas. */
export class ListPublishedLayouts {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly layouts: LayoutRepository,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  async execute(input: TenantContext): Promise<SpaceLayout[]> {
    await requireActiveLocation(this.core, input);
    const [published, zones, tables] = await Promise.all([
      this.layouts.listPublished(scopeOf(input)),
      this.zones.listByLocation(scopeOf(input)),
      this.tables.listByLocation(scopeOf(input)),
    ]);
    const active = new Set(zones.filter((z) => z.isActive).map((z) => z.id));
    return published.filter((l) => l.zoneId === null || active.has(l.zoneId)).map((l) => visible(l, tables));
  }
}

export class GetLayoutDraft {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly layouts: LayoutRepository,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  async execute(input: TenantContext & { zoneId: string | null }): Promise<{ draft: SpaceLayout | null; published: SpaceLayout | null }> {
    await requireActiveLocation(this.core, input);
    await requireSpace(this.zones, input, input.zoneId);
    const space = { ...scopeOf(input), zoneId: input.zoneId };
    const [draft, published, tables] = await Promise.all([this.layouts.findDraft(space), this.layouts.findPublished(space), this.tables.listByLocation(scopeOf(input))]);
    // OPEN: el borrador se devuelve tal cual (con mesas que ya no son colocables) para que el editor las vea; guardar o publicar así falla con 400.
    return { draft, published: published && visible(published, tables) };
  }
}

export class SaveLayoutDraft {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly layouts: LayoutRepository,
    private readonly zones: ZoneRepository,
    private readonly tables: DiningTableRepository,
  ) {}

  /** `revision` 0 crea el borrador; si no, debe ser la vigente (si no, `LayoutRevisionConflictError`). */
  async execute(input: ActorContext & LayoutContent & { zoneId: string | null; revision: number }): Promise<SpaceLayout> {
    await requireActiveLocation(this.core, input);
    await requireSpace(this.zones, input, input.zoneId);
    const current = await this.layouts.findDraft({ ...scopeOf(input), zoneId: input.zoneId });
    if ((current?.revision ?? 0) !== input.revision) throw new LayoutRevisionConflictError(current);
    const content = { canvasWidth: input.canvasWidth, canvasHeight: input.canvasHeight, elements: input.elements };
    const now = new Date();
    const draft = current ?? SpaceLayout.createDraft({ ...scopeOf(input), zoneId: input.zoneId, createdBy: input.actorUserId, now, ...content });
    if (current) current.replaceContent(content, input.actorUserId, now);
    assertPlaceable(draft, await this.tables.listByLocation(scopeOf(input)));
    await this.layouts.saveDraft(draft, input.revision); // compara y guarda atómico: gana una de dos escrituras simultáneas
    return draft;
  }
}

export class PublishLayout {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly layouts: LayoutRepository,
    private readonly notifier: LayoutNotifier,
  ) {}

  /** Todo en UNA transacción con el borrador bloqueado: dos publicaciones de la misma revisión → una gana y la otra recibe el conflicto. */
  async execute(input: ActorContext & { zoneId: string | null; revision: number }): Promise<SpaceLayout> {
    await requireActiveLocation(this.core, input);
    const space = { ...scopeOf(input), zoneId: input.zoneId };
    const published = await this.layouts.withPublishTx(async (tx) => {
      await requireSpace(tx.zones, input, input.zoneId);
      const draft = await tx.lockDraft(space);
      if (!draft || draft.revision !== input.revision) throw new LayoutRevisionConflictError(draft);
      validateLayoutContent(draft.toProps());
      assertPlaceable(draft, await tx.lockTables(scopeOf(input), draft.tableIds));
      draft.publish(await tx.nextVersion(space), input.actorUserId, new Date());
      await tx.savePublished(draft);
      return draft;
    });
    try {
      await this.notifier.layoutPublished({ ...space, version: published.version });
    } catch {
      // ponytail: ya se publicó; un fallo del aviso no debe fallar la petición (los tableros releen al reconectar). Sin logger todavía.
    }
    return published;
  }
}
