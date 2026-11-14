import { saleCompletedV1 } from '@modivara/pos-contracts';
import { toEventEnvelope } from '@modivara/core-contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { CurrencyMismatchError, EmptySaleError, InvalidQuantityError, LocationUnavailableError, NotFoundError, SaleNotOpenError } from '../domain/errors.js';
import { FakeCore, InMemorySales, InMemorySellableItems } from '../testing/in-memory.js';
import { AddSaleLine, CompleteSale, CreateSellableItem, OpenSale, UpdateSellableItem, VoidSale, VoidSaleLine } from './use-cases.js';

const ORG = '01900000-0000-7000-8000-000000000001';
const LOC = '01900000-0000-7000-8000-000000000002';
const OTHER_LOC = '01900000-0000-7000-8000-000000000003';
const USER = '01900000-0000-7000-8000-000000000004';
const ctx = { organizationId: ORG, locationId: LOC, actorUserId: USER };

let core: FakeCore, items: InMemorySellableItems, sales: InMemorySales;
let uc: ReturnType<typeof wire>;
function wire() {
  return {
    createItem: new CreateSellableItem(items, core),
    updateItem: new UpdateSellableItem(items),
    open: new OpenSale(sales, core),
    add: new AddSaleLine(sales, items),
    voidLine: new VoidSaleLine(sales),
    complete: new CompleteSale(sales),
    voidSale: new VoidSale(sales),
  };
}
beforeEach(() => {
  core = new FakeCore();
  core.add({ id: LOC, organizationId: ORG });
  core.add({ id: OTHER_LOC, organizationId: ORG });
  items = new InMemorySellableItems();
  sales = new InMemorySales();
  uc = wire();
});

const item = (name: string, unit: string, price: string, sku?: string) =>
  uc.createItem.execute({ ...ctx, name, unit, price, sku, currency: 'COP' });

/** El mismo flujo para cualquier rubro: abrir, agregar, cobrar. Devuelve el evento publicado. */
async function sell(lines: [string, string][], paymentMethod = 'cash') {
  const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
  for (const [sellableItemId, quantity] of lines) await uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId, quantity });
  await uc.complete.execute({ ...ctx, saleId: sale.id, paymentMethod });
  return saleCompletedV1.parse(JSON.parse(JSON.stringify(toEventEnvelope(sales.outbox.at(-1)!))));
}

describe('mismo motor para tres rubros (PLAN-POS-001 §2)', () => {
  it('zapatería: SKU ZAP-NEG-42', async () => {
    const shoe = await item('Zapato negro talla 42', 'unit', '189900', 'ZAP-NEG-42');
    const event = await sell([[shoe.id, '2']], 'card');
    expect(event.payload.total).toBe('379800.00');
    expect(event.payload.lines[0]).toMatchObject({ sku: 'ZAP-NEG-42', quantity: '2.000', line_total: '379800.00' });
  });
  it('cafetería de mostrador: sin mesa ni contexto externo', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const capuchino = await item('Capuchino', 'unit', '7000');
    const event = await sell([[tinto.id, '3'], [capuchino.id, '1']]);
    expect(event.payload.total).toBe('14500.00');
    expect(Object.keys(event.payload)).not.toContain('table_id');
  });
  it('servicios: cantidad decimal por horas', async () => {
    const hour = await item('Asesoría', 'h', '80000');
    const event = await sell([[hour.id, '1.5']], 'transfer');
    expect(event.payload.lines[0]).toMatchObject({ unit: 'h', quantity: '1.500', line_total: '120000.00' });
  });
});

describe('reglas de venta', () => {
  it('aritmética exacta con redondeo a centésimas, mitad hacia arriba', async () => {
    const cheese = await item('Queso', 'kg', '10.01');
    const event = await sell([[cheese.id, '0.335']]);
    expect(event.payload.total).toBe('3.35'); // 3.35335
  });
  it('unit solo admite enteros; cero y negativos no', async () => {
    const shoe = await item('Zapato', 'unit', '100');
    const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
    for (const quantity of ['1.5', '0', '-1', 'abc']) {
      await expect(uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId: shoe.id, quantity })).rejects.toThrow(InvalidQuantityError);
    }
  });
  it('la línea guarda el precio del momento: cambiar el catálogo no la altera', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
    await uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.updateItem.execute({ ...ctx, id: tinto.id, changes: { price: '3000', name: 'Tinto grande' } });
    await uc.complete.execute({ ...ctx, saleId: sale.id, paymentMethod: 'cash' });
    expect(sales.outbox[0]!.payload).toMatchObject({ total: '2500.00', lines: [{ name: 'Tinto', unit_price: '2500.00' }] });
  });
  it('una línea anulada queda para auditoría y sale del total', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
    const withLine = await uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '2' });
    await uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.voidLine.execute({ ...ctx, saleId: sale.id, lineId: withLine.activeLines[0]!.id });
    const done = await uc.complete.execute({ ...ctx, saleId: sale.id, paymentMethod: 'cash' });
    expect(done.total).toBe(250000n);
    expect(done.toProps().lines).toHaveLength(2);
  });
  it('venta vacía no se cierra; cerrada o anulada no cambia ni emite dos veces', async () => {
    const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
    await expect(uc.complete.execute({ ...ctx, saleId: sale.id, paymentMethod: 'cash' })).rejects.toThrow(EmptySaleError);
    const tinto = await item('Tinto', 'unit', '2500');
    await uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.complete.execute({ ...ctx, saleId: sale.id, paymentMethod: 'cash' });
    await expect(uc.complete.execute({ ...ctx, saleId: sale.id, paymentMethod: 'cash' })).rejects.toThrow(SaleNotOpenError);
    await expect(uc.voidSale.execute({ ...ctx, saleId: sale.id })).rejects.toThrow(SaleNotOpenError);
    expect(sales.outbox).toHaveLength(1);
  });
  it('anular una venta abierta no emite evento', async () => {
    const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
    expect((await uc.voidSale.execute({ ...ctx, saleId: sale.id })).status).toBe('voided');
    expect(sales.outbox).toHaveLength(0);
  });
  it('moneda distinta entre artículo y venta se rechaza', async () => {
    const usd = await uc.createItem.execute({ ...ctx, name: 'Gift card', unit: 'unit', price: '10', currency: 'USD' });
    const sale = await uc.open.execute({ ...ctx, currency: 'COP' });
    await expect(uc.add.execute({ ...ctx, saleId: sale.id, sellableItemId: usd.id, quantity: '1' })).rejects.toThrow(CurrencyMismatchError);
  });
});

describe('aislamiento por negocio y local', () => {
  it('artículo o venta de otro local no existen', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const other = { ...ctx, locationId: OTHER_LOC };
    const foreignSale = await uc.open.execute({ ...other, currency: 'COP' });
    await expect(uc.add.execute({ ...other, saleId: foreignSale.id, sellableItemId: tinto.id, quantity: '1' })).rejects.toThrow(NotFoundError);
    await expect(uc.complete.execute({ ...ctx, saleId: foreignSale.id, paymentMethod: 'cash' })).rejects.toThrow(NotFoundError);
  });
  it('local inactivo o de otro negocio no opera', async () => {
    core.add({ id: OTHER_LOC, organizationId: ORG, active: false });
    await expect(uc.open.execute({ ...ctx, locationId: OTHER_LOC, currency: 'COP' })).rejects.toThrow(LocationUnavailableError);
    const stranger = { ...ctx, organizationId: '01900000-0000-7000-8000-000000000009' };
    await expect(uc.open.execute({ ...stranger, currency: 'COP' })).rejects.toThrow(LocationUnavailableError);
  });
});
