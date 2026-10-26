import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, toEventEnvelope } from '@modivara/core-contracts';
import { stockAdjustedV1, stockIssuedV1, stockReceivedV1 } from '@modivara/commerce-contracts';
import { IdempotencyKeyReusedError, InsufficientStockError, InvalidMovementError, NotFoundError, ReasonDirectionMismatchError } from '../../domain/errors.js';
import { commercePrismaForTests, integrationWorld, resetCommerce } from '../../testing/integration.js';

const db = commercePrismaForTests();
const w = integrationWorld(db);
beforeEach(() => resetCommerce(db));
afterAll(() => db.$disconnect());

async function setup() {
  const basics = await w.seedBasics();
  const target = { stockLocationId: basics.stockLocation.id, productId: basics.product.id };
  const base = { ...w.actor, ...target };
  const move = async (direction: 'in' | 'out' | 'adjust', quantity: string, reasonName: string, idempotencyKey = newId()) =>
    w.registerMovement.execute({ ...base, direction, quantity, reasonId: await basics.reason(reasonName), idempotencyKey });
  const balance = async () => (await w.getBalances.execute({ ...w.t, ...target }))[0]?.quantity.toString();
  return { ...basics, target, base, move, balance };
}

describe('F4-03 libro de stock sobre PostgreSQL', () => {
  it('entrada, salida y ajuste dejan saldo, movimiento con balance_after y un evento de outbox cada uno', async () => {
    const { move, balance } = await setup();
    const received = await move('in', '10', 'Compra');
    expect(received).toMatchObject({ replayed: false });
    expect(received.movement).toMatchObject({ direction: 'in' });
    expect(received.movement.delta.toString()).toBe('10.000');
    expect(received.movement.balanceAfter.toString()).toBe('10.000');
    const issued = await move('out', '3.5', 'Venta');
    expect([issued.movement.delta.toString(), issued.movement.balanceAfter.toString()]).toEqual(['-3.500', '6.500']);
    const adjusted = await move('adjust', '-1', 'Corrección de conteo');
    expect([adjusted.movement.delta.toString(), adjusted.movement.balanceAfter.toString()]).toEqual(['-1.000', '5.500']);
    expect(await balance()).toBe('5.500');

    const events = await db.outboxEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    expect(events.map((e) => e.eventType)).toEqual(['commerce.stock.received', 'commerce.stock.issued', 'commerce.stock.adjusted']);
    expect(events.map((e) => e.aggregateId)).toEqual([received, issued, adjusted].map((r) => r.movement.id));
    expect(await db.stockMovement.count()).toBe(3);
  });

  it('salida que dejaría negativo: rechazada sin movimiento, sin evento y sin tocar el saldo', async () => {
    const { move, balance } = await setup();
    await move('in', '2', 'Compra');
    await expect(move('out', '2.001', 'Venta')).rejects.toThrow(InsufficientStockError);
    expect(await balance()).toBe('2.000');
    expect(await db.stockMovement.count()).toBe(1);
    expect(await db.outboxEvent.count()).toBe(1);
  });

  it('salida sobre un saldo que no existe: rechazada y sin dejar ni siquiera la fila de saldo', async () => {
    const { move, balance } = await setup();
    await expect(move('out', '1', 'Venta')).rejects.toThrow(InsufficientStockError);
    expect(await balance()).toBeUndefined();
    expect(await db.stockBalance.count()).toBe(0);
    expect(await db.stockMovement.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(0);
  });

  it('la misma clave devuelve el movimiento original sin aplicarlo dos veces', async () => {
    const { move, balance } = await setup();
    const key = newId();
    const first = await move('in', '5', 'Compra', key);
    const again = await move('in', '5', 'Compra', key);
    expect(again).toMatchObject({ replayed: true });
    expect(again.movement.id).toBe(first.movement.id);
    expect(await balance()).toBe('5.000');
    expect(await db.stockMovement.count()).toBe(1);
    expect(await db.outboxEvent.count()).toBe(1);
  });

  it('la clave de otro negocio no choca con la de este', async () => {
    const { move } = await setup();
    const key = newId();
    await move('in', '1', 'Compra', key);
    const w2 = integrationWorld(db);
    const b2 = await w2.seedBasics();
    await expect(
      w2.registerMovement.execute({
        ...w2.actor, stockLocationId: b2.stockLocation.id, productId: b2.product.id, direction: 'in', quantity: '1', reasonId: await b2.reason('Compra'), idempotencyKey: key,
      }),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('la clave usada en otro local del mismo negocio se rechaza sin revelar ese movimiento', async () => {
    const { move, balance } = await setup();
    const otherLoc = { organizationId: w.t.organizationId, locationId: newId() };
    const w2 = integrationWorld(db, otherLoc);
    const b2 = await w2.seedBasics();
    const key = newId();
    const other = await w2.registerMovement.execute({
      ...w2.actor, stockLocationId: b2.stockLocation.id, productId: b2.product.id, direction: 'in', quantity: '9', reasonId: await b2.reason('Compra'), idempotencyKey: key,
    });
    expect(other.replayed).toBe(false);
    await expect(move('in', '1', 'Compra', key)).rejects.toThrow(IdempotencyKeyReusedError);
    expect(await balance()).toBeUndefined();
    expect(await db.stockMovement.count()).toBe(1);
  });

  it('validaciones del dominio sin dejar rastro: motivo de otra dirección, referencias de otro local', async () => {
    const { move, base, target } = await setup();
    await expect(move('in', '1', 'Venta')).rejects.toThrow(ReasonDirectionMismatchError);
    await expect(w.registerMovement.execute({ ...base, direction: 'in', quantity: '1', reasonId: newId(), idempotencyKey: newId() })).rejects.toThrow(NotFoundError);
    await expect(w.registerMovement.execute({ ...base, productId: newId(), direction: 'in', quantity: '1', reasonId: newId(), idempotencyKey: newId() })).rejects.toThrow(NotFoundError);
    expect(target).toBeDefined();
    expect(await db.stockBalance.count()).toBe(0);
    expect(await db.stockMovement.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(0);
  });

  it('los eventos del outbox cumplen los esquemas Zod de commerce-contracts', async () => {
    const { move } = await setup();
    await move('in', '4', 'Compra');
    await move('out', '1', 'Venta');
    await move('adjust', '2', 'Corrección de conteo');
    const events = await db.outboxEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    const schemas = { 'commerce.stock.received': stockReceivedV1, 'commerce.stock.issued': stockIssuedV1, 'commerce.stock.adjusted': stockAdjustedV1 } as const;
    for (const e of events) {
      const schema = schemas[e.eventType as keyof typeof schemas];
      const envelope = toEventEnvelope({ ...e, eventId: e.id, causationId: e.causationId });
      expect(schema.safeParse(envelope).success).toBe(true);
      expect(e).toMatchObject({ eventVersion: 1, organizationId: w.t.organizationId, locationId: w.t.locationId });
    }
  });

  it('lecturas: saldos y movimientos del local, más recientes primero y con límite', async () => {
    const { move, target } = await setup();
    for (let i = 0; i < 3; i++) await move('in', '1', 'Compra');
    const listed = await w.listMovements.execute({ ...w.t, ...target, limit: 2 });
    expect(listed).toHaveLength(2);
    expect(listed[0]!.balanceAfter.toString()).toBe('3.000');
    expect((await w.getBalances.execute({ ...w.t })).map((b) => b.quantity.toString())).toEqual(['3.000']);
    expect(await w.getBalances.execute({ ...w.t, productId: newId() })).toEqual([]);
  });
});

describe('F4-04 ajuste por conteo', () => {
  it('saldo 10, contado 7 → delta -3; contado igual al saldo se rechaza', async () => {
    const { move, base, reason, balance } = await setup();
    await move('in', '10', 'Compra');
    const r = await w.adjustToCount.execute({ ...base, countedQuantity: '7', reasonId: await reason('Corrección de conteo'), idempotencyKey: newId() });
    expect(r.movement).toMatchObject({ direction: 'adjust' });
    expect([r.movement.delta.toString(), r.movement.balanceAfter.toString()]).toEqual(['-3.000', '7.000']);
    expect(await balance()).toBe('7.000');
    await expect(
      w.adjustToCount.execute({ ...base, countedQuantity: '7.000', reasonId: await reason('Corrección de conteo'), idempotencyKey: newId() }),
    ).rejects.toThrow(InvalidMovementError);
    expect(await db.stockMovement.count({ where: { direction: 'adjust' } })).toBe(1);
  });

  it('contado mayor que el saldo da delta positivo, y contado 0 vacía el saldo', async () => {
    const { move, base, reason, balance } = await setup();
    await move('in', '2', 'Compra');
    const up = await w.adjustToCount.execute({ ...base, countedQuantity: '5.5', reasonId: await reason('Corrección de conteo'), idempotencyKey: newId() });
    expect(up.movement.delta.toString()).toBe('3.500');
    await w.adjustToCount.execute({ ...base, countedQuantity: '0', reasonId: await reason('Corrección de conteo'), idempotencyKey: newId() });
    expect(await balance()).toBe('0.000');
  });
});
