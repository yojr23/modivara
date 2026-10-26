import type { Prisma } from './generated/client.js';
import type { DomainEvent } from '@modivara/core-contracts';
import type {
  BalanceKey, BalanceQuery, LedgerTransaction, MovementQuery, StockLedger, StockQueries,
} from '../../application/ports/stock-ledger.port.js';
import { ConflictError } from '../../domain/errors.js';
import { Quantity } from '../../domain/quantity.js';
import { StockBalance } from '../../domain/stock-balance.js';
import { StockMovement } from '../../domain/stock-movement.js';
import type { CommercePrisma } from './client.js';
import { isUniqueViolation } from './db.js';

const quantity = (d: Prisma.Decimal | string) => Quantity.parse(typeof d === 'string' ? d : d.toFixed(3));

const toMovement = (r: Prisma.StockMovementGetPayload<object>) =>
  StockMovement.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, stockLocationId: r.stockLocationId, productId: r.productId,
    direction: r.direction, reasonId: r.reasonId, delta: quantity(r.delta), balanceAfter: quantity(r.balanceAfter), note: r.note,
    actorUserId: r.actorUserId, occurredAt: r.occurredAt, idempotencyKey: r.idempotencyKey,
  });

const toBalance = (r: Prisma.StockBalanceGetPayload<object>) =>
  StockBalance.restore({
    stockLocationId: r.stockLocationId, productId: r.productId, organizationId: r.organizationId, locationId: r.locationId,
    quantity: quantity(r.quantity), updatedAt: r.updatedAt,
  });

const outboxRow = (e: DomainEvent) => ({
  id: e.eventId, eventType: e.eventType, eventVersion: e.eventVersion, occurredAt: e.occurredAt, organizationId: e.organizationId,
  locationId: e.locationId, aggregateId: e.aggregateId, correlationId: e.correlationId, causationId: e.causationId,
  payload: e.payload as Prisma.InputJsonValue,
});

/**
 * Libro de stock sobre PostgreSQL (DATA-001 §4). Una transacción por movimiento:
 * 1) `INSERT … ON CONFLICT DO NOTHING` de la fila de saldo en 0 y `SELECT … FOR UPDATE`: las operaciones sobre el mismo (lugar, producto) se serializan;
 * 2) el caso de uso valida con el saldo bloqueado (`StockMovement.register`) y llama a `save`;
 * 3) `save` aplica `quantity + delta` en un UPDATE atómico, inserta el movimiento con `balance_after` y los eventos de outbox.
 * Si `work` lanza, todo se revierte (incluida la fila de saldo creada en 1): una salida rechazada no deja movimiento ni evento.
 * Nunca `INSERT … ON CONFLICT DO UPDATE` con el delta: PostgreSQL valida los CHECK de la fila propuesta antes de resolver el conflicto
 * y una salida fallaría aunque el saldo existente alcance.
 */
export class PrismaStockLedger implements StockLedger, StockQueries {
  constructor(private readonly db: CommercePrisma) {}

  withLockedBalance<T>(key: BalanceKey, work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    // maxWait amplio: con muchas salidas en paralelo sobre el mismo saldo, las demás esperan turno (y una conexión del pool).
    return this.db.$transaction(
      async (db) => {
        await db.$executeRaw`
          INSERT INTO stock_balances (stock_location_id, product_id, organization_id, location_id, quantity)
          VALUES (${key.stockLocationId}::uuid, ${key.productId}::uuid, ${key.organizationId}::uuid, ${key.locationId}::uuid, 0)
          ON CONFLICT (stock_location_id, product_id) DO NOTHING`;
        const [row] = await db.$queryRaw<{ quantity: string; updated_at: Date }[]>`
          SELECT quantity::text AS quantity, updated_at FROM stock_balances
          WHERE stock_location_id = ${key.stockLocationId}::uuid AND product_id = ${key.productId}::uuid
            AND organization_id = ${key.organizationId}::uuid AND location_id = ${key.locationId}::uuid
          FOR UPDATE`;
        if (!row) throw new Error('Stock balance row not found after insert (scope mismatch)');
        const balance = StockBalance.restore({ ...key, quantity: quantity(row.quantity), updatedAt: row.updated_at });

        const tx: LedgerTransaction = {
          balance,
          findByIdempotencyKey: async ({ organizationId, idempotencyKey }) => {
            const r = await db.stockMovement.findFirst({ where: { organizationId, idempotencyKey } });
            return r && toMovement(r);
          },
          save: async (movement) => {
            const m = movement.toProps();
            const [updated] = await db.$queryRaw<{ quantity: string }[]>`
              UPDATE stock_balances SET quantity = quantity + ${m.delta.toString()}::numeric, updated_at = ${m.occurredAt}::timestamptz
              WHERE stock_location_id = ${key.stockLocationId}::uuid AND product_id = ${key.productId}::uuid
              RETURNING quantity::text AS quantity`;
            // El saldo está bloqueado: el resultado de la base tiene que coincidir con el que calculó el dominio.
            if (updated?.quantity !== m.balanceAfter.toString()) throw new Error('Stock balance diverged from the ledger calculation');
            try {
              await db.stockMovement.create({
                data: {
                  id: m.id, organizationId: m.organizationId, locationId: m.locationId, stockLocationId: m.stockLocationId, productId: m.productId,
                  direction: m.direction, reasonId: m.reasonId, delta: m.delta.toString(), balanceAfter: m.balanceAfter.toString(), note: m.note,
                  actorUserId: m.actorUserId, occurredAt: m.occurredAt, idempotencyKey: m.idempotencyKey,
                },
              });
            } catch (e) {
              // Misma clave sobre otro saldo en paralelo: el primero ganó, este se rechaza (no se aplica dos veces).
              if (isUniqueViolation(e)) throw new ConflictError('Idempotency key already used by another movement');
              throw e;
            }
            const events = movement.pullEvents();
            if (events.length > 0) await db.outboxEvent.createMany({ data: events.map(outboxRow) });
          },
        };
        return work(tx);
      },
      { timeout: 15_000, maxWait: 15_000 },
    );
  }

  async listBalances({ organizationId, locationId, stockLocationId, productId }: BalanceQuery) {
    const rows = await this.db.stockBalance.findMany({
      where: { organizationId, locationId, ...(stockLocationId && { stockLocationId }), ...(productId && { productId }) },
      orderBy: [{ stockLocationId: 'asc' }, { productId: 'asc' }],
    });
    return rows.map(toBalance);
  }

  /** Más recientes primero; `id` (UUIDv7) desempata movimientos con el mismo instante. */
  async listMovements({ organizationId, locationId, stockLocationId, productId, limit }: MovementQuery) {
    const rows = await this.db.stockMovement.findMany({
      where: { organizationId, locationId, ...(stockLocationId && { stockLocationId }), ...(productId && { productId }) },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map(toMovement);
  }
}
