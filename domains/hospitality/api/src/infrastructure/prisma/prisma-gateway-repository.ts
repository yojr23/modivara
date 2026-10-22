import { Gateway } from '../../domain/devices/gateway.js';
import { ConflictError } from '../../domain/errors.js';
import type { ById, GatewayRepository, Scope } from '../../application/ports/index.js';
import { mapUnique, type Db } from './db.js';

type Row = { id: string; organizationId: string; locationId: string; name: string; keyHash: Uint8Array; lastSeenAt: Date | null; createdAt: Date; createdBy: string | null; deactivatedAt: Date | null };

// El dominio maneja el hash en hex; la columna es bytea (32 bytes).
const toDomain = (r: Row) =>
  Gateway.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, name: r.name, keyHash: Buffer.from(r.keyHash).toString('hex'),
    lastSeenAt: r.lastSeenAt, createdAt: r.createdAt, createdBy: r.createdBy, deactivatedAt: r.deactivatedAt,
  });

export class PrismaGatewayRepository implements GatewayRepository {
  constructor(private readonly db: Db) {}

  async findById({ id, organizationId, locationId }: ById) {
    const r = await this.db.gateway.findFirst({ where: { id, organizationId, locationId } });
    return r && toDomain(r);
  }

  /** Única consulta sin tenant: la clave identifica al gateway y de él sale el tenant. Solo el hash viaja a la base. */
  async findByKeyHash(keyHash: string) {
    const r = await this.db.gateway.findUnique({ where: { keyHash: Buffer.from(keyHash, 'hex') } });
    return r && toDomain(r);
  }

  async findByIdAnyTenant(id: string) {
    const r = await this.db.gateway.findUnique({ where: { id } });
    return r && toDomain(r);
  }

  async listActive() {
    return (await this.db.gateway.findMany({ where: { deactivatedAt: null }, orderBy: { id: 'asc' } })).map(toDomain);
  }

  async listByLocation({ organizationId, locationId }: Scope) {
    const rows = await this.db.gateway.findMany({ where: { organizationId, locationId }, orderBy: { id: 'asc' } });
    return rows.map(toDomain);
  }

  save(gateway: Gateway) {
    const p = gateway.toProps();
    // La clave nunca cambia: el update no toca key_hash.
    const data = { name: p.name, lastSeenAt: p.lastSeenAt, deactivatedAt: p.deactivatedAt };
    return mapUnique(
      async () =>
        void (await this.db.gateway.upsert({
          where: { id: p.id },
          create: { id: p.id, organizationId: p.organizationId, locationId: p.locationId, keyHash: Buffer.from(p.keyHash, 'hex'), createdAt: p.createdAt, createdBy: p.createdBy, ...data },
          update: data,
        })),
      () => new ConflictError('Gateway key already exists'),
    );
  }
}
