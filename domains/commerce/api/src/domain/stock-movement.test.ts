import { describe, expect, it } from 'vitest';
import { OTHER_ORG, setup, USER } from '../testing/fixtures.js';
import { InvalidMovementError, InactiveEntityError, InsufficientStockError, OrganizationMismatchError, ReasonDirectionMismatchError } from './errors.js';
import type { MovementReason } from './movement-reason.js';
import { Quantity } from './quantity.js';
import { StockBalance } from './stock-balance.js';
import { type MovementChange, StockMovement } from './stock-movement.js';

async function scenario(start = '10') {
  const s = await setup();
  const { stockLocation, product } = s;
  const balance = StockBalance.zero(
    { stockLocationId: stockLocation.id, productId: product.id, organizationId: stockLocation.organizationId, locationId: stockLocation.locationId },
    new Date(),
  );
  balance.apply(Quantity.parse(start), new Date());
  let n = 0;
  const register = async (reasonOrName: string | MovementReason, change: MovementChange) =>
    StockMovement.register(balance, {
      id: `00000000-0000-4000-8000-0000000001${String(n++).padStart(2, '0')}`,
      eventId: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
      product,
      stockLocation,
      reason: typeof reasonOrName === 'string' ? await s.reason(reasonOrName) : reasonOrName,
      change,
      actorUserId: s.actor.actorUserId,
      idempotencyKey: `99999999-9999-4999-8999-0000000000${String(n).padStart(2, '0')}`,
      occurredAt: new Date('2026-10-19T15:00:00Z'),
    });
  return { ...s, balance, register };
}

describe('StockMovement.register', () => {
  it('in: delta positivo, saldo sube y evento received', async () => {
    const { register, balance } = await scenario('10');
    const m = await register('Compra', { kind: 'in', quantity: Quantity.parse('2.5') });
    expect(m.direction).toBe('in');
    expect(m.delta.toString()).toBe('2.500');
    expect(m.balanceAfter.toString()).toBe('12.500');
    expect(balance.quantity.toString()).toBe('12.500');
    const [event] = m.pullEvents();
    expect(event?.eventType).toBe('commerce.stock.received');
    expect(event?.payload).toMatchObject({ delta: '2.500', balance_after: '12.500', product_name: 'Cerveza', reason_name: 'Compra' });
    expect(m.pullEvents()).toEqual([]);
  });

  it('out: delta negativo y evento issued', async () => {
    const { register } = await scenario('10');
    const m = await register('Venta', { kind: 'out', quantity: Quantity.parse('4') });
    expect(m.delta.toString()).toBe('-4.000');
    expect(m.balanceAfter.toString()).toBe('6.000');
    expect(m.pullEvents()[0]?.eventType).toBe('commerce.stock.issued');
  });

  it('adjust: delta con signo ≠ 0 y evento adjusted', async () => {
    const { register } = await scenario('10');
    const m = await register('Corrección de conteo', { kind: 'adjust', delta: Quantity.parse('-3') });
    expect(m.direction).toBe('adjust');
    expect(m.balanceAfter.toString()).toBe('7.000');
    expect(m.pullEvents()[0]?.eventType).toBe('commerce.stock.adjusted');
    await expect(register('Corrección de conteo', { kind: 'adjust', delta: Quantity.zero() })).rejects.toThrow(InvalidMovementError);
  });

  it('rechaza cantidad cero o negativa en in/out', async () => {
    const { register } = await scenario();
    await expect(register('Compra', { kind: 'in', quantity: Quantity.zero() })).rejects.toThrow(InvalidMovementError);
    await expect(register('Venta', { kind: 'out', quantity: Quantity.parse('-1') })).rejects.toThrow(InvalidMovementError);
  });

  it('rechaza un motivo de otra dirección', async () => {
    const { register, balance } = await scenario();
    await expect(register('Compra', { kind: 'out', quantity: Quantity.parse('1') })).rejects.toThrow(ReasonDirectionMismatchError);
    await expect(register('Venta', { kind: 'in', quantity: Quantity.parse('1') })).rejects.toThrow(ReasonDirectionMismatchError);
    expect(balance.quantity.toString()).toBe('10.000');
  });

  it('rechaza salida mayor al saldo sin tocar el saldo', async () => {
    const { register, balance } = await scenario('3');
    await expect(register('Venta', { kind: 'out', quantity: Quantity.parse('3.001') })).rejects.toThrow(InsufficientStockError);
    expect(balance.quantity.toString()).toBe('3.000');
    const m = await register('Venta', { kind: 'out', quantity: Quantity.parse('3') });
    expect(m.balanceAfter.toString()).toBe('0.000');
  });

  it('conteo: delta = contado − saldo', async () => {
    const { register } = await scenario('10');
    const down = await register('Corrección de conteo', { kind: 'count', counted: Quantity.parse('7.5') });
    expect(down.delta.toString()).toBe('-2.500');
    expect(down.balanceAfter.toString()).toBe('7.500');
    const up = await register('Corrección de conteo', { kind: 'count', counted: Quantity.parse('9') });
    expect(up.delta.toString()).toBe('1.500');
    await expect(register('Corrección de conteo', { kind: 'count', counted: Quantity.parse('9') })).rejects.toThrow(InvalidMovementError);
    await expect(register('Corrección de conteo', { kind: 'count', counted: Quantity.parse('-1') })).rejects.toThrow(InvalidMovementError);
  });

  it('rechaza motivo desactivado', async () => {
    const s = await scenario();
    const reason = await s.reason('Compra');
    reason.deactivate(s.actor.actorUserId, new Date());
    await expect(s.register(reason, { kind: 'in', quantity: Quantity.parse('1') })).rejects.toThrow(InactiveEntityError);
  });

  it('rechaza un motivo de otro negocio', async () => {
    const s = await scenario();
    const foreign = await s.h.createMovementReason.execute({ organizationId: OTHER_ORG, actorUserId: USER, name: 'Compra', direction: 'in' });
    await expect(s.register(foreign, { kind: 'in', quantity: Quantity.parse('1') })).rejects.toThrow(OrganizationMismatchError);
  });
});
