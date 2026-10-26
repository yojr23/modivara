import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { commercePrismaForTests, resetCommerce, tenant } from '../../testing/integration.js';

// La base garantiza las invariantes de commerce aunque falle la aplicación (DATA-001 §4, F4-01).
const db = commercePrismaForTests();
beforeEach(() => resetCommerce(db));
afterAll(() => db.$disconnect());

const t = tenant();
const other = tenant();
const product = (name: string, data: { sku?: string | null } = {}, loc = t) =>
  db.product.create({ data: { ...loc, name, unit: 'bottle', ...data } });
const place = (name: string, data: { isDefault?: boolean } = {}, loc = t) => db.stockLocation.create({ data: { ...loc, name, ...data } });
const reason = (name: string, direction: 'in' | 'out' | 'adjust', organizationId = t.organizationId) =>
  db.movementReason.create({ data: { organizationId, name, direction } });
const balance = (stockLocationId: string, productId: string, quantity: string, loc = t) =>
  db.stockBalance.create({ data: { ...loc, stockLocationId, productId, quantity } });
const movement = (
  stockLocationId: string,
  productId: string,
  reasonId: string,
  direction: 'in' | 'out' | 'adjust',
  delta: string,
  extra: { idempotencyKey?: string } = {},
  loc = t,
) =>
  db.stockMovement.create({
    data: { ...loc, stockLocationId, productId, reasonId, direction, delta, balanceAfter: '10', actorUserId: newId(), idempotencyKey: newId(), ...extra },
  });

async function world() {
  const p = await product('Cerveza');
  const s = await place('Principal', { isDefault: true });
  const rIn = await reason('Compra', 'in');
  const rOut = await reason('Venta', 'out');
  const rAdj = await reason('Corrección de conteo', 'adjust');
  return { p, s, rIn, rOut, rAdj };
}

describe('migración commerce 0001', () => {
  it('nombre de producto único entre activos del local, sin distinguir mayúsculas', async () => {
    const a = await product('Cerveza');
    await expect(product('CERVEZA')).rejects.toThrow();
    await expect(product('Cerveza', {}, { ...t, locationId: newId() })).resolves.toBeDefined(); // otro local
    await expect(product('Cerveza', {}, other)).resolves.toBeDefined();
    await db.product.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(product('Cerveza')).resolves.toBeDefined();
  });

  it('SKU único entre activos del local; varios productos sin SKU pasan', async () => {
    const a = await product('A', { sku: 'S1' });
    await expect(product('B', { sku: 'S1' })).rejects.toThrow();
    await expect(product('C', { sku: 'S1' }, other)).resolves.toBeDefined();
    await expect(product('D')).resolves.toBeDefined();
    await expect(product('E')).resolves.toBeDefined();
    await db.product.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(product('B', { sku: 'S1' })).resolves.toBeDefined();
  });

  it('nombre de lugar de stock único entre activos; un solo predeterminado activo por local', async () => {
    const a = await place('Principal', { isDefault: true });
    await expect(place('principal')).rejects.toThrow();
    await expect(place('Barra', { isDefault: true })).rejects.toThrow();
    await expect(place('Barra')).resolves.toBeDefined();
    await expect(place('Principal', { isDefault: true }, other)).resolves.toBeDefined();
    await db.stockLocation.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(place('Bodega', { isDefault: true })).resolves.toBeDefined();
  });

  it('nombre de motivo único entre activos del negocio', async () => {
    const a = await reason('Compra', 'in');
    await expect(reason('COMPRA', 'in')).rejects.toThrow();
    await expect(reason('Compra', 'in', other.organizationId)).resolves.toBeDefined();
    await db.movementReason.update({ where: { id: a.id }, data: { deactivatedAt: new Date() } });
    await expect(reason('Compra', 'in')).resolves.toBeDefined();
  });

  it('saldo negativo falla; cero y positivo pasan', async () => {
    const { p, s } = await world();
    await expect(balance(s.id, p.id, '-0.001')).rejects.toThrow();
    await expect(balance(s.id, p.id, '0')).resolves.toBeDefined();
    await expect(db.stockBalance.update({ where: { stockLocationId_productId: { stockLocationId: s.id, productId: p.id } }, data: { quantity: '-1' } })).rejects.toThrow();
  });

  it('el signo de delta debe corresponder a la dirección', async () => {
    const { p, s, rIn, rOut, rAdj } = await world();
    await expect(movement(s.id, p.id, rIn.id, 'in', '-1')).rejects.toThrow();
    await expect(movement(s.id, p.id, rIn.id, 'in', '0')).rejects.toThrow();
    await expect(movement(s.id, p.id, rOut.id, 'out', '1')).rejects.toThrow();
    await expect(movement(s.id, p.id, rOut.id, 'out', '0')).rejects.toThrow();
    await expect(movement(s.id, p.id, rAdj.id, 'adjust', '0')).rejects.toThrow();
    await expect(movement(s.id, p.id, rIn.id, 'in', '2.5')).resolves.toBeDefined();
    await expect(movement(s.id, p.id, rOut.id, 'out', '-2.5')).resolves.toBeDefined();
    await expect(movement(s.id, p.id, rAdj.id, 'adjust', '-3')).resolves.toBeDefined();
    await expect(movement(s.id, p.id, rAdj.id, 'adjust', '3')).resolves.toBeDefined();
  });

  it('el motivo debe tener la misma dirección que el movimiento', async () => {
    const { p, s, rIn, rOut, rAdj } = await world();
    await expect(movement(s.id, p.id, rIn.id, 'out', '-1')).rejects.toThrow();
    await expect(movement(s.id, p.id, rOut.id, 'in', '1')).rejects.toThrow();
    await expect(movement(s.id, p.id, rIn.id, 'adjust', '1')).rejects.toThrow();
    await expect(movement(s.id, p.id, rAdj.id, 'adjust', '1')).resolves.toBeDefined();
  });

  it('idempotency_key única por negocio', async () => {
    const { p, s, rIn } = await world();
    const key = newId();
    await movement(s.id, p.id, rIn.id, 'in', '1', { idempotencyKey: key });
    await expect(movement(s.id, p.id, rIn.id, 'in', '1', { idempotencyKey: key })).rejects.toThrow();
    // otro negocio puede reutilizar la misma clave
    const po = await product('Cerveza', {}, other);
    const so = await place('Principal', {}, other);
    const ro = await reason('Compra', 'in', other.organizationId);
    await expect(movement(so.id, po.id, ro.id, 'in', '1', { idempotencyKey: key }, other)).resolves.toBeDefined();
  });

  it('FK compuestas: no se mezclan filas de locales distintos', async () => {
    const { p, s, rIn } = await world();
    const foreignProduct = await product('Ron', {}, other);
    const foreignPlace = await place('Barra', {}, other);
    await expect(balance(foreignPlace.id, p.id, '1')).rejects.toThrow(); // lugar ajeno con producto propio
    await expect(balance(s.id, foreignProduct.id, '1')).rejects.toThrow();
    await expect(movement(foreignPlace.id, p.id, rIn.id, 'in', '1')).rejects.toThrow();
    await expect(movement(s.id, foreignProduct.id, rIn.id, 'in', '1')).rejects.toThrow();
    // mismo negocio, otro local: tampoco
    const sibling = { organizationId: t.organizationId, locationId: newId() };
    const siblingPlace = await place('Barra', {}, sibling);
    await expect(movement(siblingPlace.id, p.id, rIn.id, 'in', '1')).rejects.toThrow();
    await expect(balance(siblingPlace.id, p.id, '1')).rejects.toThrow();
    expect(await db.stockMovement.count()).toBe(0);
  });

  it('índice de outbox pendiente y valores por defecto del outbox', async () => {
    const e = await db.outboxEvent.create({
      data: { eventType: 'commerce.stock.received', eventVersion: 1, ...t, aggregateId: newId(), correlationId: newId(), payload: {} },
    });
    expect(e).toMatchObject({ attempts: 0, dispatchedAt: null, causationId: null });
    const [index] = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_outbox_pending'`;
    expect(index?.indexdef).toMatch(/dispatched_at IS NULL/);
  });
});
