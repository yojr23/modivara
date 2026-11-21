import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, toEventEnvelope } from '@modivara/core-contracts';
import { saleCompletedV1 } from '@modivara/pos-contracts';
import { ConflictError, IdempotencyKeyReusedError, NotFoundError, SaleNotOpenError } from '../../domain/errors.js';
import { OpenLinkedSale, OpenSale } from '../../application/use-cases.js';
import type { ExternalLink, LocationScope } from '../../application/ports.js';
import { integrationWorld, posPrismaForTests, resetPos, tenant } from '../../testing/integration.js';
import { PrismaSaleStore } from './prisma-sale-store.js';

// PostgreSQL real, sin dobles (POS-14, POS-18, POS-19). Las carreras se repiten para cazar intercalados raros.
const REPEATS = 10;
const db = posPrismaForTests();
beforeEach(() => resetPos(db));
afterAll(() => db.$disconnect());

async function openWithLine(w: ReturnType<typeof integrationWorld>, price = '2500', quantity = '1', unit = 'unit') {
  const item = await w.createItem.execute({ ...w.actor, name: `Artículo ${newId()}`, unit, price });
  const { sale } = await w.openSale.execute({ ...w.actor, idempotencyKey: newId() });
  await w.addLine.execute({ ...w.actor, saleId: sale.id, sellableItemId: item.id, quantity, idempotencyKey: newId() });
  return { item, sale };
}

const settled = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const rejections = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);

describe('PrismaSaleStore: ida y vuelta', () => {
  it('decimales exactos en artículo, línea y evento', async () => {
    const w = integrationWorld(db);
    const big = await w.createItem.execute({ ...w.actor, name: 'Lote', unit: 'kg', price: '999999999999.99' });
    expect((await w.items.findById({ id: big.id, ...w.t }))!.price).toBe(99999999999999n);

    const { item, sale } = await openWithLine(w, '10.01', '0.335', 'kg');
    const read = await w.getSale.execute({ ...w.actor, saleId: sale.id });
    expect(read.activeLines[0]).toMatchObject({ sellableItemId: item.id, unitPriceSnapshot: 1001n, quantity: 335n, unitSnapshot: 'kg' });
    expect(read.total).toBe(335n); // 3.35335 → 3.35

    await w.complete.execute({ ...w.actor, saleId: sale.id, paymentMethod: 'cash', idempotencyKey: newId() });
    const [row] = await db.outboxEvent.findMany();
    const event = saleCompletedV1.parse(JSON.parse(JSON.stringify(toEventEnvelope({ ...row!, eventId: row!.id }))));
    expect(event.payload).toMatchObject({ total: '3.35', lines: [{ unit_price: '10.01', quantity: '0.335', line_total: '3.35' }] });
  });

  it('anular línea la conserva para auditoría; ajustes de moneda persisten', async () => {
    const w = integrationWorld(db);
    await w.updateSettings.execute({ ...w.actor, currency: 'USD' });
    const { sale } = await openWithLine(w, '1.50');
    expect(sale.currency).toBe('USD');
    const lineId = (await w.getSale.execute({ ...w.actor, saleId: sale.id })).activeLines[0]!.id;
    await w.voidLine.execute({ ...w.actor, saleId: sale.id, lineId, idempotencyKey: newId() });
    const read = await w.getSale.execute({ ...w.actor, saleId: sale.id });
    expect(read.activeLines).toHaveLength(0);
    expect(read.toProps().lines[0]).toMatchObject({ id: lineId, voidedBy: w.actor.actorUserId });
  });

  it('historial: más recientes primero, por estado y con cursor', async () => {
    const w = integrationWorld(db);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await w.openSale.execute({ ...w.actor, idempotencyKey: newId() })).sale.id);
    await w.voidSale.execute({ ...w.actor, saleId: ids[0]!, idempotencyKey: newId() });
    const all = await w.listSales.execute(w.actor);
    expect(all.map((s) => s.id)).toEqual([...ids].reverse());
    const page = await w.listSales.execute({ ...w.actor, limit: 2 });
    const last = page.at(-1)!.toProps();
    const rest = await w.listSales.execute({ ...w.actor, after: { openedAt: last.openedAt, id: last.id } });
    expect([...page, ...rest].map((s) => s.id)).toEqual(all.map((s) => s.id));
    expect((await w.listSales.execute({ ...w.actor, status: 'voided' })).map((s) => s.id)).toEqual([ids[0]]);
  });
});

describe('atomicidad: un fallo dentro de la transacción no deja nada (INV-07)', () => {
  /** Cliente que lanza al llamar `modelo.método` dentro de `$transaction` mientras `failAt.point` coincida. */
  const failing = (failAt: { point: string | null }) =>
    new Proxy(db, {
      get(target, prop) {
        if (prop !== '$transaction') return Reflect.get(target, prop);
        return (fn: (tx: unknown) => unknown, opts: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get: (t, model: string) => {
                    const v = Reflect.get(t, model);
                    if (typeof v !== 'object' || v === null) return typeof v === 'function' ? v.bind(t) : v;
                    return new Proxy(v, {
                      get: (m, method: string) => (...args: unknown[]) => {
                        if (failAt.point === `${model}.${method}`) throw new Error('fallo inducido');
                        return (m as Record<string, (...a: unknown[]) => unknown>)[method]!(...args);
                      },
                    });
                  },
                }),
              ),
            opts,
          );
      },
    });
  const rows = async () => ({
    sales: await db.sale.count(), lines: await db.saleLine.count(), keys: await db.idempotencyKey.count(),
    links: await db.saleExternalLink.count(), outbox: await db.outboxEvent.count(),
  });

  it('abrir vinculada: ni venta, ni vínculo, ni clave; el reintento con la misma clave funciona', async () => {
    const failAt = { point: null as string | null };
    const w = integrationWorld(failing(failAt) as typeof db);
    const resourceId = newId();
    w.validator.known.add(`spot:${resourceId}`);
    const cmd = { ...w.actor, provider: 'ext', resourceType: 'spot', resourceId, idempotencyKey: newId() };
    failAt.point = 'idempotencyKey.create'; // después de crear venta y vínculo
    await expect(w.openLinked.execute(cmd)).rejects.toThrow('fallo inducido');
    expect(await rows()).toEqual({ sales: 0, lines: 0, keys: 0, links: 0, outbox: 0 });
    failAt.point = null;
    expect(await w.openLinked.execute(cmd)).toMatchObject({ replayed: false, sale: { status: 'open' } });
    expect(await rows()).toMatchObject({ sales: 1, keys: 1, links: 1 });
  });

  it('cerrar: sin evento, sin clave, venta abierta y vínculo activo; el reintento cierra una sola vez', async () => {
    const failAt = { point: null as string | null };
    const w = integrationWorld(failing(failAt) as typeof db);
    const resourceId = newId();
    w.validator.known.add(`spot:${resourceId}`);
    const { sale } = await w.openLinked.execute({ ...w.actor, provider: 'ext', resourceType: 'spot', resourceId, idempotencyKey: newId() });
    const item = await w.createItem.execute({ ...w.actor, name: 'Tinto', unit: 'unit', price: '2500' });
    await w.addLine.execute({ ...w.actor, saleId: sale.id, sellableItemId: item.id, quantity: '1', idempotencyKey: newId() });
    const before = await rows();
    const cmd = { ...w.actor, saleId: sale.id, paymentMethod: 'cash', idempotencyKey: newId() };

    failAt.point = 'idempotencyKey.create'; // última escritura: ya se actualizó la venta y se insertó el evento
    await expect(w.complete.execute(cmd)).rejects.toThrow('fallo inducido');
    expect(await rows()).toEqual(before);
    expect(await db.sale.findUnique({ where: { id: sale.id } })).toMatchObject({ status: 'open', paymentMethod: null, closedAt: null });
    expect(await db.saleExternalLink.count({ where: { saleId: sale.id, active: true } })).toBe(1);

    failAt.point = null;
    expect(await w.complete.execute(cmd)).toMatchObject({ replayed: false, sale: { status: 'completed' } });
    expect(await db.outboxEvent.count({ where: { aggregateId: sale.id } })).toBe(1);
    expect((await w.complete.execute(cmd)).replayed).toBe(true);
  });
});

describe('aislamiento por negocio y local', () => {
  it('venta o artículo de otro negocio o local no existen', async () => {
    const w = integrationWorld(db);
    const { item, sale } = await openWithLine(w);
    for (const t of [tenant(), { organizationId: w.t.organizationId, locationId: newId() }]) {
      const intruder = integrationWorld(db, t);
      await expect(intruder.getSale.execute({ ...intruder.actor, saleId: sale.id })).rejects.toThrow(NotFoundError);
      await expect(intruder.complete.execute({ ...intruder.actor, saleId: sale.id, paymentMethod: 'cash', idempotencyKey: newId() }))
        .rejects.toThrow(NotFoundError);
      const own = await intruder.openSale.execute({ ...intruder.actor, idempotencyKey: newId() });
      await expect(intruder.addLine.execute({ ...intruder.actor, saleId: own.sale.id, sellableItemId: item.id, quantity: '1', idempotencyKey: newId() }))
        .rejects.toThrow(NotFoundError);
      expect(await intruder.listSales.execute(intruder.actor)).toHaveLength(1);
    }
    expect((await w.getSale.execute({ ...w.actor, saleId: sale.id })).status).toBe('open');
  });
});

describe('concurrencia e idempotencia (POS-18)', () => {
  it('dos cierres simultáneos con claves distintas: uno gana, el otro sale_not_open, un solo evento', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const w = integrationWorld(db);
      const { sale } = await openWithLine(w);
      const close = () => w.complete.execute({ ...w.actor, saleId: sale.id, paymentMethod: 'cash', idempotencyKey: newId() });
      const results = await settled([close(), close()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejections(results)[0]).toBeInstanceOf(SaleNotOpenError);
      expect(await db.outboxEvent.count({ where: { aggregateId: sale.id } })).toBe(1);
    }
  });

  it('misma clave a la vez o reintentada: una sola escritura, el resto replayed', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const w = integrationWorld(db);
      const { sale } = await openWithLine(w);
      const cmd = { ...w.actor, saleId: sale.id, paymentMethod: 'card', idempotencyKey: newId() };
      const results = await Promise.all([w.complete.execute(cmd), w.complete.execute(cmd), w.complete.execute(cmd)]);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(results.every((r) => r.sale.id === sale.id && r.sale.status === 'completed')).toBe(true);
      expect((await w.complete.execute(cmd)).replayed).toBe(true);
      expect(await db.outboxEvent.count({ where: { aggregateId: sale.id } })).toBe(1);
    }
  });

  it('abrir dos veces con la misma clave a la vez: una venta', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const w = integrationWorld(db);
      const idempotencyKey = newId();
      const [a, b] = await Promise.all([w.openSale.execute({ ...w.actor, idempotencyKey }), w.openSale.execute({ ...w.actor, idempotencyKey })]);
      expect(a.sale.id).toBe(b.sale.id);
      expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    }
    expect(await db.sale.count()).toBe(REPEATS);
  });

  it('misma clave a la vez sobre dos ventas distintas: una gana, la otra idempotency_key_reused', async () => {
    const w = integrationWorld(db);
    const one = await openWithLine(w);
    const two = await openWithLine(w);
    const idempotencyKey = newId();
    const results = await settled([one, two].map(({ sale }) => w.voidSale.execute({ ...w.actor, saleId: sale.id, idempotencyKey })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejections(results)[0]).toBeInstanceOf(IdempotencyKeyReusedError);
    expect(await db.sale.count({ where: { status: 'voided' } })).toBe(1);
  });

  it('dos aperturas simultáneas del mismo recurso externo: una venta; cerrada, el recurso queda libre', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const w = integrationWorld(db);
      const resourceId = newId();
      w.validator.known.add(`spot:${resourceId}`);
      const cmd = { ...w.actor, provider: 'ext', resourceType: 'spot', resourceId };
      const keys = [newId(), newId(), newId()];
      const results = await Promise.all(keys.map((idempotencyKey) => w.openLinked.execute({ ...cmd, idempotencyKey })));
      expect(new Set(results.map((r) => r.sale.id)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);

      const saleId = results[0]!.sale.id;
      await w.voidSale.execute({ ...w.actor, saleId, idempotencyKey: newId() });
      expect(await db.saleExternalLink.findFirst({ where: { saleId } })).toMatchObject({ active: false, releasedAt: expect.any(Date), label: `spot ${resourceId.slice(-4)}` });
      // Liberado el vínculo, la venta conserva la etiqueta (por id y en el listado).
      expect((await w.getSale.execute({ ...w.actor, saleId })).toProps().contextLabel).toBe(`spot ${resourceId.slice(-4)}`);
      expect((await w.listSales.execute(w.actor)).map((s) => s.toProps().contextLabel)).toEqual([`spot ${resourceId.slice(-4)}`]);
      // Reintento tardío de cualquiera de las tres peticiones: la venta original (anulada), sin abrir otra.
      for (const idempotencyKey of keys) {
        expect(await w.openLinked.execute({ ...cmd, idempotencyKey })).toMatchObject({ replayed: true, sale: { id: saleId, status: 'voided' } });
      }
      expect(await db.sale.count({ where: { organizationId: w.t.organizationId } })).toBe(1);
      const next = await w.openLinked.execute({ ...cmd, idempotencyKey: newId() });
      expect(next.replayed).toBe(false);
      expect(next.sale.id).not.toBe(saleId);
    }
  });

  it('recurso ya vinculado y la misma clave tomada entretanto por otra operación: idempotency_key_reused, no la venta vinculada', async () => {
    const w = integrationWorld(db);
    const resourceId = newId();
    w.validator.known.add(`spot:${resourceId}`);
    const cmd = { ...w.actor, provider: 'ext', resourceType: 'spot', resourceId };
    const linked = await w.openLinked.execute({ ...cmd, idempotencyKey: newId() });

    // Barrera: la petición A se detiene justo después de encontrar la venta vinculada, antes de atar su clave.
    let reached!: () => void, release!: () => void;
    const atGate = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    class GatedStore extends PrismaSaleStore {
      override async findByActiveLink(q: LocationScope & ExternalLink) {
        const found = await super.findByActiveLink(q);
        reached();
        await gate;
        return found;
      }
    }
    const store = new GatedStore(db);
    const openLinked = new OpenLinkedSale(store, w.settings, [w.validator], w.core);
    const key = newId();
    const a = openLinked.execute({ ...cmd, idempotencyKey: key });
    await atGate;
    const b = await new OpenSale(store, w.settings, w.core).execute({ ...w.actor, idempotencyKey: key }); // B toma la clave
    release();
    await expect(a).rejects.toThrow(IdempotencyKeyReusedError);
    expect(b.sale.id).not.toBe(linked.sale.id);
    expect(await db.idempotencyKey.findUnique({ where: { organizationId_key: { organizationId: w.t.organizationId, key } } })).toMatchObject({
      operation: 'open_sale', saleId: b.sale.id,
    });
  });

  it('reintento de un vínculo confirmado cuando el recurso ya no valida: la venta original', async () => {
    const w = integrationWorld(db);
    const resourceId = newId();
    w.validator.known.add(`spot:${resourceId}`);
    const cmd = { ...w.actor, provider: 'ext', resourceType: 'spot', resourceId, idempotencyKey: newId() };
    const first = await w.openLinked.execute(cmd);
    w.validator.known.clear();
    expect(await w.openLinked.execute(cmd)).toMatchObject({ replayed: true, sale: { id: first.sale.id } });
  });

  it('alta simultánea del mismo nombre de artículo: una ConflictError', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const w = integrationWorld(db);
      const create = () => w.createItem.execute({ ...w.actor, name: 'Tinto', unit: 'unit', price: '2500' });
      const results = await settled([create(), create()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rejections(results)[0]).toBeInstanceOf(ConflictError);
    }
  });
});
