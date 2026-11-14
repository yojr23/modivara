import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { posPrismaForTests, resetPos, tenant } from '../../testing/integration.js';

// La base garantiza las invariantes de POS aunque falle la aplicación (POS-07).
const db = posPrismaForTests();
beforeEach(() => resetPos(db));
afterAll(() => db.$disconnect());

const t = tenant();
const other = tenant();
const actor = newId();
const now = new Date();

const item = (name: string, data: { sku?: string | null; price?: string; currency?: string } = {}, loc = t) =>
  db.sellableItem.create({
    data: { id: newId(), ...loc, name, unit: 'unit', price: '1000', currency: 'COP', createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, ...data },
  });
const sale = (data: Record<string, unknown> = {}, loc = t) =>
  db.sale.create({ data: { id: newId(), ...loc, currency: 'COP', status: 'open', openedAt: now, openedBy: actor, ...data } });
const line = (saleId: string, sellableItemId: string, data: Record<string, unknown> = {}, loc = t) =>
  db.saleLine.create({
    data: {
      id: newId(), saleId, locationId: loc.locationId, sellableItemId, nameSnapshot: 'X', unitSnapshot: 'unit', unitPriceSnapshot: '1',
      quantity: '1', addedAt: now, addedBy: actor, ...data,
    },
  });
const link = (saleId: string, resourceId: string, data: Record<string, unknown> = {}, loc = t) =>
  db.saleExternalLink.create({
    data: { id: newId(), ...loc, saleId, provider: 'ext', resourceType: 'spot', resourceId, createdAt: now, createdBy: actor, ...data },
  });

describe('migración pos 0001', () => {
  it('nombre de artículo único entre activos del local, sin distinguir mayúsculas', async () => {
    const a = await item('Tinto');
    await expect(item('TINTO')).rejects.toThrow();
    await expect(item('Tinto', {}, other)).resolves.toBeDefined();
    await db.sellableItem.update({ where: { id: a.id }, data: { deactivatedAt: now } });
    await expect(item('Tinto')).resolves.toBeDefined();
  });

  it('SKU único entre activos del local; varios sin SKU pasan', async () => {
    const a = await item('A', { sku: 'S1' });
    await expect(item('B', { sku: 'S1' })).rejects.toThrow();
    await expect(item('C', { sku: 'S1' }, other)).resolves.toBeDefined();
    await expect(item('D')).resolves.toBeDefined();
    await expect(item('E')).resolves.toBeDefined();
    await db.sellableItem.update({ where: { id: a.id }, data: { deactivatedAt: now } });
    await expect(item('B', { sku: 'S1' })).resolves.toBeDefined();
  });

  it('precio no negativo, moneda ISO de tres letras', async () => {
    await expect(item('A', { price: '-0.01' })).rejects.toThrow();
    await expect(item('B', { currency: 'cop' })).rejects.toThrow();
    await expect(db.locationSettings.create({ data: { ...t, currency: 'C0P', updatedBy: actor } })).rejects.toThrow();
    await expect(item('C', { price: '0' })).resolves.toBeDefined();
  });

  it('cantidad positiva; anulación con fecha y autor juntos', async () => {
    const i = await item('A');
    const s = await sale();
    await expect(line(s.id, i.id, { quantity: '0' })).rejects.toThrow();
    await expect(line(s.id, i.id, { unitPriceSnapshot: '-1' })).rejects.toThrow();
    await expect(line(s.id, i.id, { voidedAt: now })).rejects.toThrow();
    await expect(line(s.id, i.id, { quantity: '0.001' })).resolves.toBeDefined();
  });

  it('estado coherente: abierta sin cierre, cerrada con cobro, anulada sin cobro', async () => {
    await expect(sale({ closedAt: now, closedBy: actor })).rejects.toThrow();
    await expect(sale({ status: 'completed', closedAt: now, closedBy: actor })).rejects.toThrow();
    await expect(sale({ status: 'voided' })).rejects.toThrow();
    await expect(sale({ status: 'voided', closedAt: now, closedBy: actor, paymentMethod: 'cash' })).rejects.toThrow();
    await expect(sale({ paymentMethod: 'cash' })).rejects.toThrow();
    await expect(sale({ status: 'completed', closedAt: now, closedBy: actor, paymentMethod: 'card' })).resolves.toBeDefined();
    await expect(sale({ status: 'voided', closedAt: now, closedBy: actor })).resolves.toBeDefined();
  });

  it('un vínculo activo por recurso externo', async () => {
    const resource = newId();
    const a = await sale();
    const b = await sale();
    const first = await link(a.id, resource);
    await expect(link(b.id, resource)).rejects.toThrow();
    await expect(link(b.id, resource, {}, other)).rejects.toThrow(); // venta de otro local
    await expect(link(b.id, resource, { active: false })).rejects.toThrow(); // inactivo exige released_at
    await db.saleExternalLink.update({ where: { id: first.id }, data: { active: false, releasedAt: now } });
    await expect(link(b.id, resource)).resolves.toBeDefined();
  });

  it('FK compuestas: líneas con venta y artículo del mismo local', async () => {
    const i = await item('A');
    const foreign = await item('A', {}, other);
    const s = await sale();
    await expect(line(s.id, foreign.id)).rejects.toThrow();
    const sibling = { organizationId: t.organizationId, locationId: newId() };
    const siblingSale = await sale({}, sibling);
    await expect(line(siblingSale.id, i.id, {}, sibling)).rejects.toThrow();
    expect(await db.saleLine.count()).toBe(0);
  });

  it('clave de idempotencia única por negocio', async () => {
    const s = await sale();
    const key = newId();
    await db.idempotencyKey.create({ data: { organizationId: t.organizationId, key, operation: 'open_sale', fingerprint: '{}', saleId: s.id } });
    await expect(db.idempotencyKey.create({ data: { organizationId: t.organizationId, key, operation: 'x', fingerprint: '{}', saleId: s.id } })).rejects.toThrow();
    await expect(db.idempotencyKey.create({ data: { organizationId: other.organizationId, key, operation: 'x', fingerprint: '{}', saleId: s.id } })).resolves.toBeDefined();
  });

  it('índice de outbox pendiente', async () => {
    const [index] = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'pos' AND indexname = 'ix_outbox_pending'`;
    expect(index?.indexdef).toMatch(/\(dispatched_at IS NULL\) AND \(failed_at IS NULL\)/);
  });
});
