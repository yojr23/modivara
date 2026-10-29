import type { LayoutElement } from '@modivara/hospitality-contracts';
import { LayoutRevisionConflictError } from '../../domain/errors.js';
import { SpaceLayout } from '../../domain/layouts/space-layout.js';
import type { LayoutRepository, PublishTx, Scope, SpaceScope } from '../../application/ports/index.js';
import type { HospitalityPrisma } from './client.js';
import { type Db, isUniqueViolation } from './db.js';
import type { Prisma, SpaceLayout as Row } from './generated/client.js';
import { PrismaDiningTableRepository } from './prisma-dining-table-repository.js';
import { PrismaZoneRepository } from './prisma-zone-repository.js';

const toDomain = (r: Row) => SpaceLayout.restore({ ...r, elements: r.elements as unknown as LayoutElement[] });
const json = (elements: LayoutElement[]) => elements as unknown as Prisma.InputJsonValue;
const where = ({ organizationId, locationId, zoneId }: SpaceScope) => ({ organizationId, locationId, zoneId });

async function find(db: Db, space: SpaceScope, status: 'draft' | 'published') {
  const r = await db.spaceLayout.findFirst({ where: { ...where(space), status } });
  return r && toDomain(r);
}

class PrismaPublishTx implements PublishTx {
  readonly zones;
  private readonly tables;
  constructor(private readonly tx: Prisma.TransactionClient) {
    this.zones = new PrismaZoneRepository(tx);
    this.tables = new PrismaDiningTableRepository(tx);
  }

  async lockDraft(space: SpaceScope) {
    // `IS NOT DISTINCT FROM`: el espacio por defecto tiene zone_id NULL. Tras esperar el bloqueo, la fila ya publicada deja de cumplir `status = 'draft'`.
    const rows = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM space_layouts
      WHERE organization_id = ${space.organizationId}::uuid AND location_id = ${space.locationId}::uuid
        AND zone_id IS NOT DISTINCT FROM ${space.zoneId}::uuid AND status = 'draft'
      FOR UPDATE`;
    return rows[0] ? toDomain(await this.tx.spaceLayout.findUniqueOrThrow({ where: { id: rows[0].id } })) : null;
  }

  async lockTables({ organizationId, locationId }: Scope, ids: string[]) {
    await this.tx.$queryRaw`SELECT id FROM dining_tables WHERE id = ANY(${ids}::uuid[]) AND location_id = ${locationId}::uuid FOR SHARE`;
    return (await this.tables.listByLocation({ organizationId, locationId })).filter((t) => ids.includes(t.id));
  }

  async nextVersion(space: SpaceScope) {
    const { _max } = await this.tx.spaceLayout.aggregate({ where: { ...where(space), status: { not: 'draft' } }, _max: { version: true } });
    return (_max.version ?? 0) + 1;
  }

  async savePublished(draft: SpaceLayout) {
    const p = draft.toProps();
    await this.tx.spaceLayout.updateMany({ where: { ...where(p), status: 'published' }, data: { status: 'archived' } });
    await this.tx.spaceLayout.update({
      where: { id: p.id },
      data: { status: 'published', version: p.version, publishedAt: p.publishedAt, publishedBy: p.publishedBy, updatedAt: p.updatedAt, updatedBy: p.updatedBy },
    });
  }
}

export class PrismaLayoutRepository implements LayoutRepository {
  constructor(private readonly db: HospitalityPrisma) {}

  findDraft(space: SpaceScope) {
    return find(this.db, space, 'draft');
  }

  findPublished(space: SpaceScope) {
    return find(this.db, space, 'published');
  }

  async listPublished({ organizationId, locationId }: Scope) {
    const rows = await this.db.spaceLayout.findMany({ where: { organizationId, locationId, status: 'published' }, orderBy: { id: 'asc' } });
    return rows.map(toDomain).sort((a, b) => Number(a.zoneId !== null) - Number(b.zoneId !== null));
  }

  async saveDraft(layout: SpaceLayout, expectedRevision: number) {
    const p = layout.toProps();
    const conflict = async () => new LayoutRevisionConflictError(await find(this.db, p, 'draft'));
    if (expectedRevision === 0) {
      try {
        await this.db.spaceLayout.create({ data: { ...p, elements: json(p.elements) } });
      } catch (e) {
        // El índice único (un borrador por espacio) decide entre dos creaciones simultáneas.
        throw isUniqueViolation(e) ? await conflict() : e;
      }
      return;
    }
    // Compara y actualiza en una sola sentencia: si otro guardó o publicó, no coincide y no escribe.
    const { count } = await this.db.spaceLayout.updateMany({
      where: { id: p.id, status: 'draft', revision: expectedRevision },
      data: { canvasWidth: p.canvasWidth, canvasHeight: p.canvasHeight, elements: json(p.elements), revision: p.revision, updatedAt: p.updatedAt, updatedBy: p.updatedBy },
    });
    if (count === 0) throw await conflict();
  }

  withPublishTx<T>(work: (tx: PublishTx) => Promise<T>) {
    return this.db.$transaction((tx) => work(new PrismaPublishTx(tx)));
  }
}
