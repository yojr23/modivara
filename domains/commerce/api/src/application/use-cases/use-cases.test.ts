import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { ConflictError, InsufficientStockError, InvalidQuantityError, LocationUnavailableError, NotFoundError, ReasonDirectionMismatchError } from '../../domain/index.js';
import { newId } from '@modivara/core-contracts';
import { Quantity, StockMovement } from '../../domain/index.js';
import { LOC, ORG, OTHER_LOC, OTHER_ORG, setup, USER } from '../../testing/fixtures.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T15:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('catálogo', () => {
  it('rechaza producto duplicado por nombre (sin distinguir mayúsculas) o SKU, pero solo entre activos', async () => {
    const { h, actor, product } = await setup();
    await expect(h.createProduct.execute({ ...actor, name: ' cerveza ', unit: 'unit' })).rejects.toThrow(ConflictError);
    await h.createProduct.execute({ ...actor, name: 'Ron', sku: 'R1', unit: 'bottle' });
    await expect(h.createProduct.execute({ ...actor, name: 'Ron 2', sku: 'R1', unit: 'bottle' })).rejects.toThrow(ConflictError);
    await h.deactivateProduct.execute({ ...actor, productId: product.id });
    await expect(h.createProduct.execute({ ...actor, name: 'Cerveza', unit: 'unit' })).resolves.toBeDefined();
  });

  it('el mismo nombre existe en otro negocio sin conflicto', async () => {
    const { h, product } = await setup();
    const other = await h.createProduct.execute({ organizationId: OTHER_ORG, locationId: OTHER_LOC, actorUserId: USER, name: product.name, unit: 'unit' });
    expect(other.id).not.toBe(product.id);
  });

  it('actualiza nombre/SKU/categoría y no permite choques', async () => {
    const { h, actor, product } = await setup();
    const ron = await h.createProduct.execute({ ...actor, name: 'Ron', unit: 'bottle' });
    const updated = await h.updateProduct.execute({ ...actor, productId: ron.id, sku: 'R-1', category: 'Licores' });
    expect([updated.sku, updated.category, updated.unit]).toEqual(['R-1', 'Licores', 'bottle']);
    await h.updateProduct.execute({ ...actor, productId: ron.id, category: null });
    expect(ron.category).toBeNull();
    await expect(h.updateProduct.execute({ ...actor, productId: ron.id, name: product.name })).rejects.toThrow(ConflictError);
  });

  it('al actualizar solo consulta unicidad de lo que cambió', async () => {
    const { h, actor, product } = await setup();
    const byName = vi.spyOn(h.products, 'findActiveByName');
    const bySku = vi.spyOn(h.products, 'findActiveBySku');
    await h.updateProduct.execute({ ...actor, productId: product.id, category: 'Bebidas' });
    await h.updateProduct.execute({ ...actor, productId: product.id, name: product.name });
    expect([byName.mock.calls.length, bySku.mock.calls.length]).toEqual([0, 0]);
    await h.updateProduct.execute({ ...actor, productId: product.id, name: 'Cerveza 2', sku: 'C-2' });
    expect([byName.mock.calls.length, bySku.mock.calls.length]).toEqual([1, 1]);
  });

  it('el catálogo es por local: mismo nombre/SKU en otro local del negocio no choca y no se ve entre locales', async () => {
    const { h, actor, product } = await setup();
    const LOC_B = '66666666-6666-4666-8666-666666666666';
    h.core.add({ id: LOC_B, organizationId: ORG });
    const ctxB = { ...actor, locationId: LOC_B };
    const sku = await h.createProduct.execute({ ...actor, name: 'Ron', sku: 'R1', unit: 'bottle' });
    const inB = await h.createProduct.execute({ ...ctxB, name: product.name, unit: 'bottle' });
    await h.createProduct.execute({ ...ctxB, name: 'Ron', sku: 'R1', unit: 'bottle' });
    expect(inB.locationId).toBe(LOC_B);
    await expect(h.updateProduct.execute({ ...ctxB, productId: product.id, name: 'X' })).rejects.toThrow(NotFoundError);
    await expect(h.deactivateProduct.execute({ ...ctxB, productId: sku.id })).rejects.toThrow(NotFoundError);
    await expect(h.createProduct.execute({ ...actor, locationId: OTHER_LOC, name: 'Z', unit: 'unit' })).rejects.toThrow(LocationUnavailableError);
  });

  it('un producto de otro negocio no existe', async () => {
    const { h, product } = await setup();
    await expect(
      h.updateProduct.execute({ organizationId: OTHER_ORG, locationId: OTHER_LOC, actorUserId: USER, productId: product.id, name: 'X' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('lugares de stock', () => {
  it('crea "Principal" una sola vez por local y valida el local con Core', async () => {
    const { h, actor, stockLocation } = await setup();
    expect([stockLocation.name, stockLocation.isDefault]).toEqual(['Principal', true]);
    const again = await h.ensureDefaultStockLocation.execute({ ...actor, locationId: LOC });
    expect(again.id).toBe(stockLocation.id);
    await expect(h.ensureDefaultStockLocation.execute({ ...actor, locationId: OTHER_LOC })).rejects.toThrow(LocationUnavailableError);
    await expect(h.ensureDefaultStockLocation.execute({ ...actor, locationId: 'no-existe' })).rejects.toThrow(LocationUnavailableError);
  });

  it('crea lugares adicionales no predeterminados con nombre único por local', async () => {
    const { h, actor } = await setup();
    const barra = await h.createStockLocation.execute({ ...actor, locationId: LOC, name: 'Barra' });
    expect(barra.isDefault).toBe(false);
    await expect(h.createStockLocation.execute({ ...actor, locationId: LOC, name: 'barra' })).rejects.toThrow(ConflictError);
  });
});

describe('motivos', () => {
  it('siembra los motivos una vez y es idempotente', async () => {
    const { h, actor } = await setup(); // setup ya sembró
    expect(await h.seedMovementReasons.execute(actor)).toHaveLength(0);
    const fresh = await h.seedMovementReasons.execute({ organizationId: OTHER_ORG, actorUserId: USER });
    expect(fresh).toHaveLength(SEEDED_MOVEMENT_REASONS.length);
  });

  it('crea y desactiva motivos; uno desactivado no se puede usar', async () => {
    const { h, actor, stockLocation, product, idem } = await setup();
    const reason = await h.createMovementReason.execute({ ...actor, name: 'Promoción', direction: 'out' });
    await expect(h.createMovementReason.execute({ ...actor, name: 'promoción', direction: 'out' })).rejects.toThrow(ConflictError);
    await h.deactivateMovementReason.execute({ ...actor, reasonId: reason.id });
    await expect(
      h.registerMovement.execute({ ...actor, stockLocationId: stockLocation.id, productId: product.id, direction: 'out', reasonId: reason.id, quantity: '1', idempotencyKey: idem() }),
    ).rejects.toThrow(/deactivated/);
  });
});

describe('movimientos', () => {
  async function stocked(initial = '10') {
    const s = await setup();
    const target = { ...s.actor, stockLocationId: s.stockLocation.id, productId: s.product.id };
    const compra = await s.reason('Compra');
    const venta = await s.reason('Venta');
    const conteo = await s.reason('Corrección de conteo');
    await s.h.registerMovement.execute({ ...target, direction: 'in', reasonId: compra.id, quantity: initial, idempotencyKey: s.idem() });
    return { ...s, target, compra, venta, conteo };
  }

  it('entrada, salida y saldo con decimales exactos', async () => {
    const s = await stocked('0.1');
    await s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '0.2', idempotencyKey: s.idem() });
    const [balance] = await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC });
    expect(balance?.quantity.toString()).toBe('0.300');
    const { movement } = await s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '0.3', idempotencyKey: s.idem() });
    expect(movement.delta.toString()).toBe('-0.300');
    expect(movement.balanceAfter.toString()).toBe('0.000');
  });

  it('rechaza motivo de otra dirección y salida mayor al saldo sin dejar rastro', async () => {
    const s = await stocked('5');
    const before = s.h.ledger.outbox.length;
    await expect(
      s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).rejects.toThrow(ReasonDirectionMismatchError);
    await expect(
      s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '5.001', idempotencyKey: s.idem() }),
    ).rejects.toThrow(InsufficientStockError);
    expect(s.h.ledger.outbox).toHaveLength(before);
    expect(await s.h.listMovements.execute({ organizationId: ORG, locationId: LOC })).toHaveLength(1);
    expect((await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC }))[0]?.quantity.toString()).toBe('5.000');
  });

  it('es idempotente por (negocio, key): devuelve el original y no aplica dos veces', async () => {
    const s = await stocked('5');
    const key = s.idem();
    const first = await s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '2', idempotencyKey: key });
    const outboxSize = s.h.ledger.outbox.length;
    const second = await s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '2', idempotencyKey: key });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.movement.id).toBe(first.movement.id);
    expect((await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC }))[0]?.quantity.toString()).toBe('7.000');
    expect(s.h.ledger.outbox).toHaveLength(outboxSize);
  });

  it('rechaza cantidades mal formadas', async () => {
    const s = await stocked();
    await expect(
      s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '1.2345', idempotencyKey: s.idem() }),
    ).rejects.toThrow(InvalidQuantityError);
  });

  it('ajuste por conteo calcula delta = contado − saldo', async () => {
    const s = await stocked('10');
    const down = await s.h.adjustToCount.execute({ ...s.target, reasonId: s.conteo.id, countedQuantity: '8.5', idempotencyKey: s.idem() });
    expect(down.movement.direction).toBe('adjust');
    expect(down.movement.delta.toString()).toBe('-1.500');
    const up = await s.h.adjustToCount.execute({ ...s.target, reasonId: s.conteo.id, countedQuantity: '12', idempotencyKey: s.idem() });
    expect(up.movement.delta.toString()).toBe('3.500');
    expect(up.movement.balanceAfter.toString()).toBe('12.000');
    const zero = await s.h.adjustToCount.execute({ ...s.target, reasonId: s.conteo.id, countedQuantity: '0', idempotencyKey: s.idem() });
    expect(zero.movement.balanceAfter.toString()).toBe('0.000');
  });

  it('ajuste directo con delta negativo mayor al saldo se rechaza', async () => {
    const s = await stocked('2');
    await expect(
      s.h.registerMovement.execute({ ...s.target, direction: 'adjust', reasonId: s.conteo.id, quantity: '-3', idempotencyKey: s.idem() }),
    ).rejects.toThrow(InsufficientStockError);
  });

  it('emite el evento correcto al outbox en la misma operación, con el sobre de DATA-001', async () => {
    const s = await stocked('10');
    const { movement } = await s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '4', note: 'mesa 3', idempotencyKey: s.idem() });
    const event = s.h.ledger.outbox.at(-1)!;
    expect(event).toMatchObject({
      eventType: 'commerce.stock.issued',
      eventVersion: 1,
      organizationId: ORG,
      locationId: LOC,
      aggregateId: movement.id,
      causationId: null,
      payload: { movement_id: movement.id, delta: '-4.000', balance_after: '6.000', reason_name: 'Venta', actor_user_id: USER },
    });
  });

  it('aísla negocios: no ve ni mueve stock ajeno, y la misma key en otro negocio es independiente', async () => {
    const s = await stocked('5');
    const intruder = { organizationId: OTHER_ORG, actorUserId: USER, locationId: OTHER_LOC };
    await expect(
      s.h.registerMovement.execute({ ...intruder, stockLocationId: s.stockLocation.id, productId: s.product.id, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).rejects.toThrow(NotFoundError);
    expect(await s.h.getBalances.execute(intruder)).toEqual([]);
    expect(await s.h.listMovements.execute(intruder)).toEqual([]);

    // mismo uuid de key en un segundo negocio con su propio stock
    s.h.core.add({ id: OTHER_LOC, organizationId: OTHER_ORG });
    await s.h.seedMovementReasons.execute(intruder);
    const sl = await s.h.ensureDefaultStockLocation.execute(intruder);
    const p = await s.h.createProduct.execute({ ...intruder, name: 'Cerveza', unit: 'bottle' });
    const compra = (await s.h.reasons.findActiveByName({ organizationId: OTHER_ORG, name: 'Compra' }))!;
    const key = s.idem();
    const mine = await s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: key });
    const theirs = await s.h.registerMovement.execute({ ...intruder, stockLocationId: sl.id, productId: p.id, direction: 'in', reasonId: compra.id, quantity: '9', idempotencyKey: key });
    expect(theirs.replayed).toBe(false);
    expect(theirs.movement.id).not.toBe(mine.movement.id);
  });

  it('acota por local: un usuario del local A no mueve ni lista stock del local B del mismo negocio', async () => {
    const s = await stocked('5');
    const LOC_B = '66666666-6666-4666-8666-666666666666';
    s.h.core.add({ id: LOC_B, organizationId: ORG });
    const ctxB = { ...s.actor, locationId: LOC_B };
    const bodegaB = await s.h.createStockLocation.execute({ ...ctxB, name: 'Bodega B' });
    const productB = await s.h.createProduct.execute({ ...ctxB, name: 'Cerveza', unit: 'bottle' });
    await s.h.registerMovement.execute({ ...ctxB, stockLocationId: bodegaB.id, productId: productB.id, direction: 'in', reasonId: s.compra.id, quantity: '3', idempotencyKey: s.idem() });
    // actor autorizado solo en A envía la bodega de B
    await expect(
      s.h.registerMovement.execute({ ...s.target, stockLocationId: bodegaB.id, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      s.h.adjustToCount.execute({ ...s.target, stockLocationId: bodegaB.id, reasonId: s.conteo.id, countedQuantity: '0', idempotencyKey: s.idem() }),
    ).rejects.toThrow(NotFoundError);
    // lecturas solo del local autorizado
    const balances = await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC });
    expect(balances.map((b) => b.locationId)).toEqual([LOC]);
    const moves = await s.h.listMovements.execute({ organizationId: ORG, locationId: LOC });
    expect(moves.every((m) => m.locationId === LOC)).toBe(true);
    expect(await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC_B })).toHaveLength(1);
    // un local de otro negocio no se acepta en lecturas
    await expect(s.h.getBalances.execute({ organizationId: ORG, locationId: OTHER_LOC })).rejects.toThrow(LocationUnavailableError);
  });

  it('un movimiento exige que el producto sea del local del contexto', async () => {
    const s = await stocked('5');
    const LOC_B = '66666666-6666-4666-8666-666666666666';
    s.h.core.add({ id: LOC_B, organizationId: ORG });
    const ctxB = { ...s.actor, locationId: LOC_B };
    const bodegaB = await s.h.createStockLocation.execute({ ...ctxB, name: 'Bodega B' });
    // lugar de stock de B pero producto de A: el producto no existe para B
    await expect(
      s.h.registerMovement.execute({ ...ctxB, stockLocationId: bodegaB.id, productId: s.product.id, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).rejects.toThrow(NotFoundError);
    // los motivos siguen siendo por negocio: el mismo motivo sirve en B con un producto de B
    const pB = await s.h.createProduct.execute({ ...ctxB, name: 'Cerveza', unit: 'bottle' });
    await expect(
      s.h.registerMovement.execute({ ...ctxB, stockLocationId: bodegaB.id, productId: pB.id, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).resolves.toBeDefined();
  });

  it('un local inactivo bloquea los movimientos', async () => {
    const s = await stocked('1');
    s.h.core.add({ id: LOC, organizationId: ORG, active: false });
    await expect(
      s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).rejects.toThrow(LocationUnavailableError);
  });

  it('lista movimientos más recientes primero, con límite y filtros', async () => {
    const s = await stocked('10');
    await s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '1', idempotencyKey: s.idem() });
    await s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '2', idempotencyKey: s.idem() });
    const all = await s.h.listMovements.execute({ organizationId: ORG, locationId: LOC, productId: s.product.id });
    expect(all.map((m) => m.delta.toString())).toEqual(['-2.000', '-1.000', '10.000']);
    expect(await s.h.listMovements.execute({ organizationId: ORG, locationId: LOC, limit: 1 })).toHaveLength(1);
  });
});

describe('ledger transaccional (withLockedBalance)', () => {
  async function stocked(initial: string) {
    const s = await setup();
    const target = { ...s.actor, stockLocationId: s.stockLocation.id, productId: s.product.id };
    const compra = await s.reason('Compra');
    const venta = await s.reason('Venta');
    await s.h.registerMovement.execute({ ...target, direction: 'in', reasonId: compra.id, quantity: initial, idempotencyKey: s.idem() });
    return { ...s, target, venta };
  }

  it('dos salidas concurrentes que juntas superan el saldo: una se rechaza', async () => {
    const s = await stocked('10');
    const out = () => s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '6', idempotencyKey: s.idem() });
    const results = await Promise.allSettled([out(), out()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InsufficientStockError);
    expect((await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC }))[0]?.quantity.toString()).toBe('4.000');
  });

  it('la misma key en paralelo se aplica una sola vez', async () => {
    const s = await stocked('10');
    const key = s.idem();
    const out = () => s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '3', idempotencyKey: key });
    const [a, b] = await Promise.all([out(), out()]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(a.movement.id).toBe(b.movement.id);
    expect((await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC }))[0]?.quantity.toString()).toBe('7.000');
  });

  it('si el trabajo falla tras guardar, rollback sin rastro (saldo, movimiento ni outbox)', async () => {
    const s = await stocked('10');
    const outbox = s.h.ledger.outbox.length;
    const key = { stockLocationId: s.stockLocation.id, productId: s.product.id, organizationId: ORG, locationId: LOC };
    await expect(
      s.h.ledger.withLockedBalance(key, async (tx) => {
        const m = StockMovement.register(tx.balance, {
          id: newId(), eventId: newId(), product: s.product, stockLocation: s.stockLocation, reason: s.venta,
          change: { kind: 'out', quantity: Quantity.parse('4') }, actorUserId: USER, idempotencyKey: s.idem(), occurredAt: new Date(),
        });
        await tx.save(m);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(s.h.ledger.outbox).toHaveLength(outbox);
    expect(await s.h.listMovements.execute({ organizationId: ORG, locationId: LOC })).toHaveLength(1);
    expect((await s.h.getBalances.execute({ organizationId: ORG, locationId: LOC }))[0]?.quantity.toString()).toBe('10.000');
    // el candado se libera: la siguiente operación procede
    await expect(
      s.h.registerMovement.execute({ ...s.target, direction: 'out', reasonId: s.venta.id, quantity: '1', idempotencyKey: s.idem() }),
    ).resolves.toBeDefined();
  });
});
