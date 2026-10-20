import { describe, expect, it } from 'vitest';
import { SEEDED_MOVEMENT_REASONS } from '@modivara/commerce-contracts';
import { InsufficientStockError, InvalidQuantityError, ReasonDirectionMismatchError } from '../../domain/index.js';
import { LOC, ORG, OTHER_LOC, OTHER_ORG, setup, USER } from '../../testing/fixtures.js';
import { ConflictError, LocationUnavailableError, NotFoundError } from '../errors.js';

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
    const other = await h.createProduct.execute({ organizationId: OTHER_ORG, actorUserId: USER, name: product.name, unit: 'unit' });
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

  it('un producto de otro negocio no existe', async () => {
    const { h, product } = await setup();
    await expect(
      h.updateProduct.execute({ organizationId: OTHER_ORG, actorUserId: USER, productId: product.id, name: 'X' }),
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
    ).rejects.toThrow(/desactivado/);
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
    const [balance] = await s.h.getBalances.execute({ organizationId: ORG });
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
    expect(await s.h.listMovements.execute({ organizationId: ORG })).toHaveLength(1);
    expect((await s.h.getBalances.execute({ organizationId: ORG }))[0]?.quantity.toString()).toBe('5.000');
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
    expect((await s.h.getBalances.execute({ organizationId: ORG }))[0]?.quantity.toString()).toBe('7.000');
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
    const intruder = { organizationId: OTHER_ORG, actorUserId: USER };
    await expect(
      s.h.registerMovement.execute({ ...intruder, stockLocationId: s.stockLocation.id, productId: s.product.id, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: s.idem() }),
    ).rejects.toThrow(NotFoundError);
    expect(await s.h.getBalances.execute(intruder)).toEqual([]);
    expect(await s.h.listMovements.execute(intruder)).toEqual([]);

    // mismo uuid de key en un segundo negocio con su propio stock
    s.h.core.add({ id: OTHER_LOC, organizationId: OTHER_ORG });
    await s.h.seedMovementReasons.execute(intruder);
    const sl = await s.h.ensureDefaultStockLocation.execute({ ...intruder, locationId: OTHER_LOC });
    const p = await s.h.createProduct.execute({ ...intruder, name: 'Cerveza', unit: 'bottle' });
    const compra = (await s.h.reasons.findActiveByName(OTHER_ORG, 'Compra'))!;
    const key = s.idem();
    const mine = await s.h.registerMovement.execute({ ...s.target, direction: 'in', reasonId: s.compra.id, quantity: '1', idempotencyKey: key });
    const theirs = await s.h.registerMovement.execute({ ...intruder, stockLocationId: sl.id, productId: p.id, direction: 'in', reasonId: compra.id, quantity: '9', idempotencyKey: key });
    expect(theirs.replayed).toBe(false);
    expect(theirs.movement.id).not.toBe(mine.movement.id);
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
    const all = await s.h.listMovements.execute({ organizationId: ORG, productId: s.product.id });
    expect(all.map((m) => m.delta.toString())).toEqual(['-2.000', '-1.000', '10.000']);
    expect(await s.h.listMovements.execute({ organizationId: ORG, limit: 1 })).toHaveLength(1);
  });
});
