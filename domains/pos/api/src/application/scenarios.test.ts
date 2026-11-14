import { saleCompletedV1 } from '@modivara/pos-contracts';
import { toEventEnvelope } from '@modivara/core-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@modivara/core-contracts';
import {
  ConflictError, CurrencyMismatchError, EmptySaleError, IdempotencyKeyReusedError, InvalidQuantityError, InvalidValueError, LocationUnavailableError,
  NotFoundError, SaleNotOpenError,
} from '../domain/errors.js';
import { FakeCore, FakeReferenceValidator, InMemoryPosSettings, InMemorySales, InMemorySellableItems } from '../testing/in-memory.js';
import {
  AddSaleLine, CompleteSale, CreateSellableItem, GetPosSettings, ListSales, ListSellableItems, OpenLinkedSale, OpenSale, UpdatePosSettings,
  UpdateSellableItem, VoidSale, VoidSaleLine,
} from './use-cases.js';

const ORG = '01900000-0000-7000-8000-000000000001';
const LOC = '01900000-0000-7000-8000-000000000002';
const OTHER_LOC = '01900000-0000-7000-8000-000000000003';
const USER = '01900000-0000-7000-8000-000000000004';
const ctx = { organizationId: ORG, locationId: LOC, actorUserId: USER };

let core: FakeCore, items: InMemorySellableItems, sales: InMemorySales, settings: InMemoryPosSettings, validator: FakeReferenceValidator;
let uc: ReturnType<typeof wire>;
function wire() {
  const openSale = new OpenSale(sales, settings, core);
  const addLine = new AddSaleLine(sales, items, core);
  const voidLine = new VoidSaleLine(sales, core);
  const complete = new CompleteSale(sales, core);
  const voidSale = new VoidSale(sales, core);
  const key = () => ({ idempotencyKey: newId() });
  return {
    createItem: new CreateSellableItem(items, settings, core),
    updateItem: new UpdateSellableItem(items, core),
    listItems: new ListSellableItems(items, core),
    getSettings: new GetPosSettings(settings, core),
    updateSettings: new UpdatePosSettings(settings, core),
    openLinked: new OpenLinkedSale(sales, settings, [validator], core),
    listSales: new ListSales(sales, core),
    openSale, addLine, voidLine, complete, voidSale,
    // Atajos: cada llamada es una petición nueva (clave nueva) y devuelve la venta.
    open: async (c: typeof ctx) => (await openSale.execute({ ...c, ...key() })).sale,
    add: async (c: Omit<Parameters<AddSaleLine['execute']>[0], 'idempotencyKey'>) => (await addLine.execute({ ...c, ...key() })).sale,
    voidLn: async (c: Omit<Parameters<VoidSaleLine['execute']>[0], 'idempotencyKey'>) => (await voidLine.execute({ ...c, ...key() })).sale,
    close: async (c: Omit<Parameters<CompleteSale['execute']>[0], 'idempotencyKey'>) => (await complete.execute({ ...c, ...key() })).sale,
    cancel: async (c: Omit<Parameters<VoidSale['execute']>[0], 'idempotencyKey'>) => (await voidSale.execute({ ...c, ...key() })).sale,
  };
}
beforeEach(() => {
  core = new FakeCore();
  core.add({ id: LOC, organizationId: ORG });
  core.add({ id: OTHER_LOC, organizationId: ORG });
  items = new InMemorySellableItems();
  sales = new InMemorySales();
  settings = new InMemoryPosSettings();
  validator = new FakeReferenceValidator();
  uc = wire();
});

const item = (name: string, unit: string, price: string, sku?: string) =>
  uc.createItem.execute({ ...ctx, name, unit, price, sku });

/** El mismo flujo para cualquier rubro: abrir, agregar, cobrar. Devuelve el evento publicado. */
async function sell(lines: [string, string][], paymentMethod = 'cash') {
  const sale = await uc.open(ctx);
  for (const [sellableItemId, quantity] of lines) await uc.add({ ...ctx, saleId: sale.id, sellableItemId, quantity });
  await uc.close({ ...ctx, saleId: sale.id, paymentMethod });
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
    const sale = await uc.open(ctx);
    for (const quantity of ['1.5', '0', '-1', 'abc']) {
      await expect(uc.add({ ...ctx, saleId: sale.id, sellableItemId: shoe.id, quantity })).rejects.toThrow(InvalidQuantityError);
    }
  });
  it('la línea guarda el precio del momento: cambiar el catálogo no la altera', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const sale = await uc.open(ctx);
    await uc.add({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.updateItem.execute({ ...ctx, id: tinto.id, changes: { price: '3000', name: 'Tinto grande' } });
    await uc.close({ ...ctx, saleId: sale.id, paymentMethod: 'cash' });
    expect(sales.outbox[0]!.payload).toMatchObject({ total: '2500.00', lines: [{ name: 'Tinto', unit_price: '2500.00' }] });
  });
  it('una línea anulada queda para auditoría y sale del total', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const sale = await uc.open(ctx);
    const withLine = await uc.add({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '2' });
    await uc.add({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.voidLn({ ...ctx, saleId: sale.id, lineId: withLine.activeLines[0]!.id });
    const done = await uc.close({ ...ctx, saleId: sale.id, paymentMethod: 'cash' });
    expect(done.total).toBe(250000n);
    expect(done.toProps().lines).toHaveLength(2);
  });
  it('venta vacía no se cierra; cerrada o anulada no cambia ni emite dos veces', async () => {
    const sale = await uc.open(ctx);
    await expect(uc.close({ ...ctx, saleId: sale.id, paymentMethod: 'cash' })).rejects.toThrow(EmptySaleError);
    const tinto = await item('Tinto', 'unit', '2500');
    await uc.add({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.close({ ...ctx, saleId: sale.id, paymentMethod: 'cash' });
    await expect(uc.close({ ...ctx, saleId: sale.id, paymentMethod: 'cash' })).rejects.toThrow(SaleNotOpenError);
    await expect(uc.cancel({ ...ctx, saleId: sale.id })).rejects.toThrow(SaleNotOpenError);
    expect(sales.outbox).toHaveLength(1);
  });
  it('anular una venta abierta no emite evento', async () => {
    const sale = await uc.open(ctx);
    expect((await uc.cancel({ ...ctx, saleId: sale.id })).status).toBe('voided');
    expect(sales.outbox).toHaveLength(0);
  });
  it('ningún importe de línea ni total supera NUMERIC(14,2)', async () => {
    const big = await item('Lote', 'kg', '999999999999.99');
    const sale = await uc.open(ctx);
    await expect(uc.add({ ...ctx, saleId: sale.id, sellableItemId: big.id, quantity: '2' })).rejects.toThrow(InvalidValueError);
    await uc.add({ ...ctx, saleId: sale.id, sellableItemId: big.id, quantity: '0.6' });
    await expect(uc.add({ ...ctx, saleId: sale.id, sellableItemId: big.id, quantity: '0.6' })).rejects.toThrow(InvalidValueError);
  });
  it('moneda distinta entre artículo y venta se rechaza', async () => {
    await uc.updateSettings.execute({ ...ctx, currency: 'USD' });
    const usd = await item('Gift card', 'unit', '10');
    await uc.updateSettings.execute({ ...ctx, currency: 'COP' });
    const sale = await uc.open(ctx);
    await expect(uc.add({ ...ctx, saleId: sale.id, sellableItemId: usd.id, quantity: '1' })).rejects.toThrow(CurrencyMismatchError);
  });
});

describe('aislamiento por negocio y local', () => {
  it('artículo o venta de otro local no existen', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const other = { ...ctx, locationId: OTHER_LOC };
    const foreignSale = await uc.open(other);
    await expect(uc.add({ ...other, saleId: foreignSale.id, sellableItemId: tinto.id, quantity: '1' })).rejects.toThrow(NotFoundError);
    await expect(uc.close({ ...ctx, saleId: foreignSale.id, paymentMethod: 'cash' })).rejects.toThrow(NotFoundError);
  });
  it('desactivar el local frena también las ventas ya abiertas', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const sale = await uc.open(ctx);
    core.add({ id: LOC, organizationId: ORG, active: false });
    await expect(uc.add({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1' })).rejects.toThrow(LocationUnavailableError);
    await expect(uc.close({ ...ctx, saleId: sale.id, paymentMethod: 'cash' })).rejects.toThrow(LocationUnavailableError);
  });
  it('local inactivo o de otro negocio no opera', async () => {
    core.add({ id: OTHER_LOC, organizationId: ORG, active: false });
    await expect(uc.open({ ...ctx, locationId: OTHER_LOC })).rejects.toThrow(LocationUnavailableError);
    const stranger = { ...ctx, organizationId: '01900000-0000-7000-8000-000000000009' };
    await expect(uc.open(stranger)).rejects.toThrow(LocationUnavailableError);
  });
});

describe('moneda por local (POS-09)', () => {
  it('sin ajustes vale COP; artículos y ventas toman la moneda guardada', async () => {
    expect(await uc.getSettings.execute(ctx)).toEqual({ currency: 'COP' });
    await uc.updateSettings.execute({ ...ctx, currency: 'USD' });
    expect((await item('Gift card', 'unit', '10')).currency).toBe('USD');
    expect((await uc.open(ctx)).currency).toBe('USD');
    expect(await uc.getSettings.execute({ ...ctx, locationId: OTHER_LOC })).toEqual({ currency: 'COP' });
    await expect(uc.updateSettings.execute({ ...ctx, currency: 'usd' })).rejects.toThrow(InvalidValueError);
  });
});

describe('catálogo', () => {
  it('nombre repetido entre activos da conflicto; el listado trae inactivos, por nombre', async () => {
    await item('Tinto', 'unit', '2500');
    await expect(item('TINTO', 'unit', '1')).rejects.toThrow(ConflictError);
    await item('Agua', 'unit', '2000');
    expect((await uc.listItems.execute(ctx)).map((i) => i.name)).toEqual(['Agua', 'Tinto']);
  });
});

describe('idempotencia (POS-18)', () => {
  it('reintentar con la misma clave devuelve la misma venta y un solo evento', async () => {
    const idempotencyKey = newId();
    const first = await uc.openSale.execute({ ...ctx, idempotencyKey });
    const again = await uc.openSale.execute({ ...ctx, idempotencyKey });
    expect(again).toMatchObject({ replayed: true, sale: { id: first.sale.id } });
    expect(first.replayed).toBe(false);

    const tinto = await item('Tinto', 'unit', '2500');
    const add = { ...ctx, saleId: first.sale.id, sellableItemId: tinto.id, quantity: '1', idempotencyKey: newId() };
    await uc.addLine.execute(add);
    expect((await uc.addLine.execute(add)).sale.activeLines).toHaveLength(1);

    const close = { ...ctx, saleId: first.sale.id, paymentMethod: 'cash', idempotencyKey: newId() };
    await uc.complete.execute(close);
    const replay = await uc.complete.execute(close);
    expect(replay).toMatchObject({ replayed: true, sale: { status: 'completed' } });
    expect(sales.outbox).toHaveLength(1);
  });

  it('la misma clave con otra petición u operación se rechaza', async () => {
    const tinto = await item('Tinto', 'unit', '2500');
    const sale = await uc.open(ctx);
    const idempotencyKey = newId();
    await uc.addLine.execute({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '1', idempotencyKey });
    await expect(uc.addLine.execute({ ...ctx, saleId: sale.id, sellableItemId: tinto.id, quantity: '2', idempotencyKey }))
      .rejects.toThrow(IdempotencyKeyReusedError);
    await expect(uc.voidSale.execute({ ...ctx, saleId: sale.id, idempotencyKey })).rejects.toThrow(IdempotencyKeyReusedError);
    // en otro local, la misma clave también es otra petición: nunca devuelve la venta ajena
    await expect(uc.openSale.execute({ ...ctx, locationId: OTHER_LOC, idempotencyKey })).rejects.toThrow(IdempotencyKeyReusedError);
    await expect(uc.openSale.execute({ ...ctx, idempotencyKey: 'no-uuid' })).rejects.toThrow(InvalidValueError);
  });
});

describe('ventas vinculadas a un recurso externo (POS-15)', () => {
  const resourceId = '01900000-0000-7000-8000-0000000000aa';
  const linked = { ...ctx, provider: 'ext', resourceType: 'spot', resourceId };

  it('abrir dos veces el mismo recurso devuelve la misma venta; cerrada, se abre una nueva', async () => {
    validator.known.add(`spot:${resourceId}`);
    const first = await uc.openLinked.execute(linked);
    const again = await uc.openLinked.execute(linked);
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ replayed: true, sale: { id: first.sale.id } });

    const tinto = await item('Tinto', 'unit', '2500');
    await uc.add({ ...ctx, saleId: first.sale.id, sellableItemId: tinto.id, quantity: '1' });
    await uc.close({ ...ctx, saleId: first.sale.id, paymentMethod: 'cash' });
    const next = await uc.openLinked.execute(linked);
    expect(next.replayed).toBe(false);
    expect(next.sale.id).not.toBe(first.sale.id);
  });

  it('proveedor no registrado o recurso desconocido → no existe', async () => {
    await expect(uc.openLinked.execute(linked)).rejects.toThrow(NotFoundError);
    validator.known.add(`spot:${resourceId}`);
    await expect(uc.openLinked.execute({ ...linked, provider: 'other' })).rejects.toThrow(NotFoundError);
    expect(sales.rows.size).toBe(0);
  });
});

describe('historial', () => {
  it('más recientes primero, por estado y con cursor', async () => {
    vi.useFakeTimers();
    try {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, i)));
        ids.push((await uc.open(ctx)).id);
      }
      await uc.cancel({ ...ctx, saleId: ids[0]! });
      const page = await uc.listSales.execute({ ...ctx, limit: 2 });
      expect(page.map((s) => s.id)).toEqual([ids[2], ids[1]]);
      const last = page.at(-1)!.toProps();
      expect((await uc.listSales.execute({ ...ctx, after: { openedAt: last.openedAt, id: last.id } })).map((s) => s.id)).toEqual([ids[0]]);
      expect((await uc.listSales.execute({ ...ctx, status: 'voided' })).map((s) => s.id)).toEqual([ids[0]]);
    } finally {
      vi.useRealTimers();
    }
  });
});
