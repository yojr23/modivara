import { ConflictError } from '../../domain/errors.js';
import { MovementReason } from '../../domain/movement-reason.js';
import type { MovementReasonRepository } from '../../application/ports/movement-reason.repository.js';
import { mapUnique, type Db } from './db.js';
import type { MovementReason as MovementReasonRow } from './generated/client.js';

const toDomain = (r: MovementReasonRow) =>
  MovementReason.restore({
    id: r.id, organizationId: r.organizationId, name: r.name, direction: r.direction,
    deactivatedAt: r.deactivatedAt, createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy!, updatedBy: r.updatedBy!,
  });

export class PrismaMovementReasonRepository implements MovementReasonRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId }: { id: string; organizationId: string }) {
    const r = await this.db.movementReason.findFirst({ where: { id, organizationId } });
    return r && toDomain(r);
  }

  async findActiveByName({ organizationId, name }: { organizationId: string; name: string }) {
    const [row] = await this.db.$queryRaw<{ id: string }[]>`
      SELECT id FROM movement_reasons WHERE organization_id = ${organizationId}::uuid AND deactivated_at IS NULL AND lower(name) = lower(${name})`;
    return row ? this.findById({ id: row.id, organizationId }) : null;
  }

  async list({ organizationId }: { organizationId: string }) {
    const rows = await this.db.movementReason.findMany({ where: { organizationId }, orderBy: [{ direction: 'asc' }, { name: 'asc' }, { id: 'asc' }] });
    return rows.map(toDomain);
  }

  save(reason: MovementReason) {
    const p = reason.toProps();
    const data = { deactivatedAt: p.deactivatedAt, updatedAt: p.updatedAt, updatedBy: p.updatedBy };
    return mapUnique(
      async () =>
        void (await this.db.movementReason.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, name: p.name, direction: p.direction, createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data, // nombre y dirección no se editan (ver MovementReason)
        })),
      () => new ConflictError(`An active reason named "${p.name}" already exists`),
    );
  }
}
