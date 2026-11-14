import { type DomainEvent, newId } from '@modivara/core-contracts';
import { MONEY_SCALE, QUANTITY_SCALE, formatScaled, parseScaled } from '@modivara/pos-contracts';
import type { ExternalLink, IdempotencyKey, LocationScope, SaleStore, SaleWrite, ScopedId } from '../../application/ports.js';
import { IdempotencyKeyReusedError, NotFoundError } from '../../domain/errors.js';
import { Sale, type SaleLine, type SaleProps } from '../../domain/sale.js';
import type { PosPrisma } from './client.js';
import { isUniqueViolation, type Db } from './db.js';
import type { Prisma } from './generated/client.js';

// Etiqueta del vínculo más reciente: sigue visible en el historial aunque el vínculo ya no esté activo.
const withLines = {
  lines: { orderBy: [{ addedAt: 'asc' }, { id: 'asc' }] },
  links: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { label: true } },
} satisfies Prisma.SaleInclude;
type SaleRow = Prisma.SaleGetPayload<{ include: typeof withLines }>;

// Decimales siempre como texto: Number perdería centavos en montos grandes.
const toSale = (r: SaleRow) =>
  Sale.restore({
    id: r.id, organizationId: r.organizationId, locationId: r.locationId, currency: r.currency, status: r.status,
    paymentMethod: r.paymentMethod, openedAt: r.openedAt, openedBy: r.openedBy, closedAt: r.closedAt, closedBy: r.closedBy,
    contextLabel: r.links[0]?.label ?? null,
    lines: r.lines.map((l) => ({
      id: l.id, sellableItemId: l.sellableItemId, skuSnapshot: l.skuSnapshot, nameSnapshot: l.nameSnapshot, unitSnapshot: l.unitSnapshot,
      unitPriceSnapshot: parseScaled(l.unitPriceSnapshot.toFixed(MONEY_SCALE), MONEY_SCALE),
      quantity: parseScaled(l.quantity.toFixed(QUANTITY_SCALE), QUANTITY_SCALE),
      addedAt: l.addedAt, addedBy: l.addedBy, voidedAt: l.voidedAt, voidedBy: l.voidedBy,
    })),
  });

const lineRow = (p: SaleProps, l: SaleLine) => ({
  id: l.id, saleId: p.id, locationId: p.locationId, sellableItemId: l.sellableItemId, skuSnapshot: l.skuSnapshot, nameSnapshot: l.nameSnapshot,
  unitSnapshot: l.unitSnapshot, unitPriceSnapshot: formatScaled(l.unitPriceSnapshot, MONEY_SCALE), quantity: formatScaled(l.quantity, QUANTITY_SCALE),
  addedAt: l.addedAt, addedBy: l.addedBy, voidedAt: l.voidedAt, voidedBy: l.voidedBy,
});

const outboxRow = (e: DomainEvent) => ({
  id: e.eventId, eventType: e.eventType, eventVersion: e.eventVersion, occurredAt: e.occurredAt, organizationId: e.organizationId,
  locationId: e.locationId, aggregateId: e.aggregateId, correlationId: e.correlationId, causationId: e.causationId,
  payload: e.payload as Prisma.InputJsonValue,
});

const TX = { timeout: 15_000, maxWait: 15_000 };

/**
 * Ventas sobre PostgreSQL (POS-14, POS-18). Cada mutación es una transacción que bloquea la venta (`FOR UPDATE`):
 * dos cierres simultáneos se serializan y el segundo ve la venta ya cerrada (`sale_not_open`), así que hay un solo evento.
 * La clave de idempotencia se guarda en la misma transacción: si `work` falla no queda clave y el reintento vuelve a intentar.
 */
export class PrismaSaleStore implements SaleStore {
  constructor(private readonly db: PosPrisma) {}

  async open(sale: Sale, idem: IdempotencyKey | null, link?: ExternalLink): Promise<SaleWrite> {
    const p = sale.toProps();
    try {
      await this.db.$transaction(async (tx) => {
        await tx.sale.create({
          data: {
            id: p.id, organizationId: p.organizationId, locationId: p.locationId, currency: p.currency, status: p.status,
            paymentMethod: p.paymentMethod, openedAt: p.openedAt, openedBy: p.openedBy, closedAt: p.closedAt, closedBy: p.closedBy,
          },
        });
        if (p.lines.length > 0) await tx.saleLine.createMany({ data: p.lines.map((l) => lineRow(p, l)) });
        if (link) {
          await tx.saleExternalLink.create({
            data: { id: newId(), organizationId: p.organizationId, locationId: p.locationId, saleId: p.id, ...link, label: p.contextLabel, createdAt: p.openedAt, createdBy: p.openedBy },
          });
        }
        if (idem) await tx.idempotencyKey.create({ data: { organizationId: p.organizationId, ...idem, saleId: p.id } });
        await persistEvents(tx, sale);
      }, TX);
      return { sale, replayed: false };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // La misma clave o el mismo recurso ya los tomó otra petición, que ya confirmó.
      const replay = idem && (await this.replay(this.db, p, idem));
      if (replay) return replay;
      const linked = link && (await this.findByActiveLink({ organizationId: p.organizationId, locationId: p.locationId, ...link }));
      if (!linked) throw e;
      // La clave queda atada a la venta vinculada: un reintento tardío la devuelve aunque ya esté cerrada. Si otra petición tomó
      // la clave entretanto, manda lo que ella confirmó (misma petición → su venta; otra → idempotency_key_reused).
      if (idem) {
        try {
          await this.db.idempotencyKey.create({ data: { organizationId: p.organizationId, ...idem, saleId: linked.id } });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          const taken = await this.replay(this.db, p, idem);
          if (taken) return taken;
          throw err;
        }
      }
      return { sale: linked, replayed: true };
    }
  }

  async mutate(q: ScopedId, idem: IdempotencyKey, work: (sale: Sale) => void): Promise<SaleWrite> {
    try {
      return await this.db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sales
          WHERE id = ${q.id}::uuid AND organization_id = ${q.organizationId}::uuid AND location_id = ${q.locationId}::uuid
          FOR UPDATE`;
        if (locked.length === 0) throw new NotFoundError('Sale');
        const replay = await this.replay(tx, q, idem);
        if (replay) return replay;

        const sale = (await load(tx, q))!;
        const voidedBefore = new Map(sale.toProps().lines.map((l) => [l.id, l.voidedAt]));
        work(sale);
        const p = sale.toProps();
        await tx.sale.update({
          where: { id: p.id },
          data: { status: p.status, paymentMethod: p.paymentMethod, closedAt: p.closedAt, closedBy: p.closedBy },
        });
        const added = p.lines.filter((l) => !voidedBefore.has(l.id));
        if (added.length > 0) await tx.saleLine.createMany({ data: added.map((l) => lineRow(p, l)) });
        for (const l of p.lines) {
          if (l.voidedAt && voidedBefore.get(l.id) === null) {
            await tx.saleLine.update({ where: { id: l.id }, data: { voidedAt: l.voidedAt, voidedBy: l.voidedBy } });
          }
        }
        await persistEvents(tx, sale);
        await tx.idempotencyKey.create({ data: { organizationId: p.organizationId, ...idem, saleId: p.id } });
        // Cerrada o anulada: el recurso externo queda libre para una venta nueva.
        if (p.status !== 'open') {
          await tx.saleExternalLink.updateMany({ where: { saleId: p.id, active: true }, data: { active: false, releasedAt: p.closedAt } });
        }
        return { sale, replayed: false };
      }, TX);
    } catch (e) {
      // La misma clave usada a la vez sobre otra venta: la otra confirmó primero; esta es un reuso.
      if (isUniqueViolation(e)) {
        const replay = await this.replay(this.db, q, idem);
        if (replay) return replay;
      }
      throw e;
    }
  }

  findReplay(scope: LocationScope, idem: IdempotencyKey) {
    return this.replay(this.db, scope, idem);
  }

  findById(q: ScopedId) {
    return load(this.db, q);
  }

  async findByActiveLink({ organizationId, locationId, provider, resourceType, resourceId }: LocationScope & ExternalLink) {
    const link = await this.db.saleExternalLink.findFirst({ where: { organizationId, locationId, provider, resourceType, resourceId, active: true } });
    return link && load(this.db, { id: link.saleId, organizationId, locationId });
  }

  /** `opened_at` lo escribe la app con `new Date()` (precisión de ms, igual que el cursor): el keyset no pierde ni repite filas. */
  async list({ organizationId, locationId, status, limit, after }: Parameters<SaleStore['list']>[0]) {
    const rows = await this.db.sale.findMany({
      where: {
        organizationId, locationId, ...(status && { status }),
        ...(after && { OR: [{ openedAt: { lt: after.openedAt } }, { openedAt: after.openedAt, id: { lt: after.id } }] }),
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: withLines,
    });
    return rows.map(toSale);
  }

  /**
   * Clave ya usada: misma operación y petición → la venta en su estado actual; otra → `IdempotencyKeyReusedError`.
   * La venta se carga acotada al negocio y local de la petición (la FK compuesta ya impide claves de otro negocio).
   */
  private async replay(db: Db, scope: LocationScope, idem: IdempotencyKey): Promise<SaleWrite | null> {
    const k = await db.idempotencyKey.findUnique({ where: { organizationId_key: { organizationId: scope.organizationId, key: idem.key } } });
    if (!k) return null;
    const sale = k.operation === idem.operation && k.fingerprint === idem.fingerprint && (await load(db, { ...scope, id: k.saleId }));
    if (!sale) throw new IdempotencyKeyReusedError('Idempotency key already used by another request');
    return { sale, replayed: true };
  }
}

async function load(db: Db, { id, organizationId, locationId }: ScopedId): Promise<Sale | null> {
  const r = await db.sale.findFirst({ where: { id, organizationId, locationId }, include: withLines });
  return r && toSale(r);
}

async function persistEvents(tx: Db, sale: Sale): Promise<void> {
  const events = sale.pullEvents();
  if (events.length > 0) await tx.outboxEvent.createMany({ data: events.map(outboxRow) });
}
