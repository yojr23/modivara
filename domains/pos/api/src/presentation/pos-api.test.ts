import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, permissionsFor, toEventEnvelope, type LocationRole, type RequestActor } from '@modivara/core-contracts';
import {
  posSettingsSchema, saleCursor, saleCompletedV1, saleResultSchema, saleSchema, sellableItemSchema, type SaleDto, type SellableItemDto,
} from '@modivara/pos-contracts';
import { createPosTestApp, type TestCaller } from '../testing/http.js';

let t: Awaited<ReturnType<typeof createPosTestApp>>;
const orgA = newId(), orgB = newId();
const shoes = newId(), cafe = newId(), service = newId(), locB = newId();

const actor = (organizationId: string): RequestActor => ({
  actorUserId: newId(), organizationId, isPlatform: false, isOwner: false, sessionId: newId(), actingOrganizationId: null,
});
const caller = (roles: LocationRole[], locs = [shoes, cafe, service], organizationId = orgA): TestCaller => ({
  actor: actor(organizationId),
  permissions: Object.fromEntries(locs.map((l) => [l, [...permissionsFor(roles, { isOwner: false, isPlatform: false })]])),
  modules: ['pos'],
});
const admin = caller(['admin']);
const cashier = caller(['cashier']);
const staff = caller(['staff', 'inventory']);
const adminNoModule: TestCaller = { ...admin, modules: ['hospitality', 'commerce'] };
const adminB = caller(['admin'], [locB], orgB);

const key = () => ({ 'Idempotency-Key': newId() });
const path = (loc: string, rest = '') => `/locations/${loc}/pos${rest}`;

beforeAll(async () => {
  t = await createPosTestApp();
  for (const [id, organizationId] of [[shoes, orgA], [cafe, orgA], [service, orgA], [locB, orgB]] as const) t.core.add({ id, organizationId });
});
afterAll(() => t.app.close());

async function item(loc: string, body: object): Promise<SellableItemDto> {
  const res = await t.as(admin).post(path(loc, '/items'), body);
  expect(res.status).toBe(201);
  return sellableItemSchema.parse(res.body);
}
const result = (res: { body: unknown }) => saleResultSchema.parse(res.body);

/** Mismo flujo, mismos endpoints, sin ramas por rubro: abrir, agregar líneas, cerrar. */
async function sell(loc: string, lines: Array<[SellableItemDto, string]>, who = cashier): Promise<SaleDto> {
  const opened = await t.as(who).post(path(loc, '/sales'), undefined, key());
  expect(opened.status).toBe(201);
  const saleId = result(opened).sale.id;
  for (const [i, quantity] of lines) {
    expect((await t.as(who).post(path(loc, `/sales/${saleId}/lines`), { sellable_item_id: i.id, quantity }, key())).status).toBe(201);
  }
  const done = await t.as(who).post(path(loc, `/sales/${saleId}/complete`), { payment_method: 'cash' }, key());
  expect(done.status).toBe(201);
  return result(done).sale;
}

describe('POS-20: tres rubros con los mismos endpoints', () => {
  it('zapatería: talla por SKU, dos pares', async () => {
    const pair = await item(shoes, { name: 'Tenis negro 42', sku: 'ZAP-NEG-42', category: 'Calzado', unit: 'unit', price: '189900' });
    expect(pair).toMatchObject({ price: '189900.00', currency: 'COP', active: true });
    const sale = await sell(shoes, [[pair, '2']]);
    expect(sale).toMatchObject({ status: 'completed', total: '379800.00', payment_method: 'cash', closed_by: cashier.actor.actorUserId, context_label: null });
    expect(sale.lines[0]).toMatchObject({ sku: 'ZAP-NEG-42', quantity: '2.000', unit_price: '189900.00', line_total: '379800.00' });
  });

  it('cafetería de mostrador: venta sin vínculo externo, varias líneas', async () => {
    const coffee = await item(cafe, { name: 'Café americano', unit: 'unit', price: '4500' });
    const bread = await item(cafe, { name: 'Pan de bono', unit: 'unit', price: '2500' });
    const sale = await sell(cafe, [[coffee, '1'], [bread, '3']]);
    expect(sale.total).toBe('12000.00');
    expect(sale.lines.map((l) => l.line_total)).toEqual(['4500.00', '7500.00']);
  });

  it('servicio por horas: 1.5 h', async () => {
    const hour = await item(service, { name: 'Asesoría', unit: 'h', price: '80000' });
    const sale = await sell(service, [[hour, '1.5']]);
    expect(sale.lines[0]).toMatchObject({ unit: 'h', quantity: '1.500', line_total: '120000.00' });
    expect(sale.total).toBe('120000.00');
  });

  it('cada cierre deja un pos.sale.completed.v1 válido en el outbox', () => {
    const events = t.repos.sales.outbox.filter((e) => e.eventType === 'pos.sale.completed');
    expect(events.length).toBeGreaterThanOrEqual(3);
    for (const e of events) expect(() => saleCompletedV1.parse(JSON.parse(JSON.stringify(toEventEnvelope(e))))).not.toThrow();
  });
});

describe('POS-17: módulo, permisos y local', () => {
  it('caja vende y lee; no gestiona catálogo ni ajustes ni anula ventas; admin sí', async () => {
    const coffee = await item(cafe, { name: `Tinto ${newId()}`, unit: 'unit', price: '2000' });
    expect((await t.as(cashier).get(path(cafe, '/items'))).status).toBe(200);
    expect((await t.as(cashier).get(path(cafe, '/settings'))).body).toEqual({ currency: 'COP' });
    expect((await t.as(cashier).post(path(cafe, '/items'), { name: 'X', unit: 'unit', price: '1' })).status).toBe(403);
    expect((await t.as(cashier).patch(path(cafe, `/items/${coffee.id}`), { price: '1' })).status).toBe(403);
    expect((await t.as(cashier).post(path(cafe, `/items/${coffee.id}/deactivate`))).status).toBe(403);
    expect((await t.as(cashier).put(path(cafe, '/settings'), { currency: 'USD' })).status).toBe(403);

    const saleId = result(await t.as(cashier).post(path(cafe, '/sales'), undefined, key())).sale.id;
    const denied = await t.as(cashier).post(path(cafe, `/sales/${saleId}/void`), undefined, key());
    expect([denied.status, denied.body.code]).toEqual([403, 'permission_denied']);
    const voided = await t.as(admin).post(path(cafe, `/sales/${saleId}/void`), undefined, key());
    expect([voided.status, result(voided).sale.status]).toEqual([201, 'voided']);
  });

  it('staff e inventory sin permisos POS: 403; sin el módulo: 403 module_disabled', async () => {
    expect((await t.as(staff).get(path(cafe, '/sales'))).status).toBe(403);
    expect((await t.as(staff).post(path(cafe, '/sales'), undefined, key())).status).toBe(403);
    const noModule = await t.as(adminNoModule).get(path(cafe, '/items'));
    expect([noModule.status, noModule.body.code]).toEqual([403, 'module_disabled']);
  });

  it('local de otro negocio o venta de otro local: 404; id inválido: 400', async () => {
    expect((await t.as(admin).get(path(locB, '/sales'))).status).toBe(404);
    expect((await t.as(adminB).get(path(cafe, '/items'))).status).toBe(404);
    const saleId = result(await t.as(cashier).post(path(cafe, '/sales'), undefined, key())).sale.id;
    expect((await t.as(cashier).get(path(shoes, `/sales/${saleId}`))).status).toBe(404);
    expect((await t.as(cashier).post(path(shoes, `/sales/${saleId}/complete`), { payment_method: 'cash' }, key())).status).toBe(404);
    expect((await t.as(cashier).get(path(cafe, '/sales/no-es-uuid'))).status).toBe(400);
  });
});

describe('POS-18: idempotencia', () => {
  it('Idempotency-Key obligatoria (uuid); repetir devuelve 200 replayed; otra petición con la misma clave 409', async () => {
    const coffee = await item(cafe, { name: `Capuchino ${newId()}`, unit: 'unit', price: '6000' });
    expect((await t.as(cashier).post(path(cafe, '/sales'))).status).toBe(400);
    expect((await t.as(cashier).post(path(cafe, '/sales'), undefined, { 'Idempotency-Key': 'abc' })).status).toBe(400);

    const k = key();
    const first = await t.as(cashier).post(path(cafe, '/sales'), undefined, k);
    const again = await t.as(cashier).post(path(cafe, '/sales'), undefined, k);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(result(again)).toMatchObject({ replayed: true, sale: { id: result(first).sale.id } });

    const saleId = result(first).sale.id;
    const lineKey = key();
    const line = (quantity: string) => t.as(cashier).post(path(cafe, `/sales/${saleId}/lines`), { sellable_item_id: coffee.id, quantity }, lineKey);
    expect((await line('2')).status).toBe(201);
    expect((await line('2')).status).toBe(200);
    const reused = await line('3');
    expect([reused.status, reused.body.code]).toEqual([409, 'idempotency_key_reused']);
    const sale = saleSchema.parse((await t.as(cashier).get(path(cafe, `/sales/${saleId}`))).body);
    expect(sale.lines).toHaveLength(1);
    expect(sale.total).toBe('12000.00');
  });
});

describe('reglas de la venta por HTTP', () => {
  it('anular línea, cerrar vacía 409, cantidad inválida 400, venta cerrada 409, artículo inactivo 409', async () => {
    const coffee = await item(cafe, { name: `Latte ${newId()}`, unit: 'unit', price: '7000' });
    const saleId = result(await t.as(cashier).post(path(cafe, '/sales'), undefined, key())).sale.id;
    const add = (body: object) => t.as(cashier).post(path(cafe, `/sales/${saleId}/lines`), body, key());

    const fractional = await add({ sellable_item_id: coffee.id, quantity: '1.5' });
    expect([fractional.status, fractional.body.code]).toEqual([400, 'invalid_quantity']);
    const lineId = result(await add({ sellable_item_id: coffee.id, quantity: '1' })).sale.lines[0]!.id;
    const voided = await t.as(cashier).post(path(cafe, `/sales/${saleId}/lines/${lineId}/void`), undefined, key());
    expect(result(voided).sale).toMatchObject({ total: '0.00', lines: [{ id: lineId }] });
    expect(result(voided).sale.lines[0]!.voided_at).not.toBeNull();
    const empty = await t.as(cashier).post(path(cafe, `/sales/${saleId}/complete`), { payment_method: 'card' }, key());
    expect([empty.status, empty.body.code]).toEqual([409, 'empty_sale']);
    expect((await t.as(cashier).post(path(cafe, `/sales/${saleId}/complete`), { payment_method: 'bitcoin' }, key())).status).toBe(400);

    await add({ sellable_item_id: coffee.id, quantity: '2' });
    expect((await t.as(cashier).post(path(cafe, `/sales/${saleId}/complete`), { payment_method: 'card' }, key())).status).toBe(201);
    const closed = await add({ sellable_item_id: coffee.id, quantity: '1' });
    expect([closed.status, closed.body.code]).toEqual([409, 'sale_not_open']);

    expect((await t.as(admin).post(path(cafe, `/items/${coffee.id}/deactivate`))).status).toBe(204);
    const other = result(await t.as(cashier).post(path(cafe, '/sales'), undefined, key())).sale.id;
    const inactive = await t.as(cashier).post(path(cafe, `/sales/${other}/lines`), { sellable_item_id: coffee.id, quantity: '1' }, key());
    expect([inactive.status, inactive.body.code]).toEqual([409, 'inactive_entity']);
  });

  it('moneda del local: artículos nuevos la toman; mezclar monedas en una venta 409', async () => {
    const saleId = result(await t.as(cashier).post(path(service, '/sales'), undefined, key())).sale.id;
    expect(posSettingsSchema.parse((await t.as(admin).put(path(service, '/settings'), { currency: 'USD' })).body)).toEqual({ currency: 'USD' });
    const usd = await item(service, { name: 'Consulting', unit: 'h', price: '50' });
    expect(usd.currency).toBe('USD');
    const mixed = await t.as(cashier).post(path(service, `/sales/${saleId}/lines`), { sellable_item_id: usd.id, quantity: '1' }, key());
    expect([mixed.status, mixed.body.code]).toEqual([409, 'currency_mismatch']);
    expect((await t.as(admin).put(path(service, '/settings'), { currency: 'usd' })).status).toBe(400);
    await t.as(admin).put(path(service, '/settings'), { currency: 'COP' });
  });

  it('catálogo: duplicado 409, edición conserva unidad y moneda, cuerpo inválido 400', async () => {
    const boots = await item(shoes, { name: 'Bota café 40', sku: 'BOT-CAF-40', unit: 'unit', price: '250000' });
    const dup = await t.as(admin).post(path(shoes, '/items'), { name: 'Otra', sku: 'BOT-CAF-40', unit: 'unit', price: '1' });
    expect([dup.status, dup.body.code]).toEqual([409, 'conflict']);
    const edited = await t.as(admin).patch(path(shoes, `/items/${boots.id}`), { price: '240000.5', category: null });
    expect(sellableItemSchema.parse(edited.body)).toMatchObject({ price: '240000.50', unit: 'unit', currency: 'COP', category: null });
    expect((await t.as(admin).post(path(shoes, '/items'), { name: 'X', unit: 'par', price: '1' })).status).toBe(400);
    expect((await t.as(admin).post(path(shoes, '/items'), { name: 'X', unit: 'unit', price: '-1' })).status).toBe(400);
  });

  it('historial: más recientes primero, filtro por estado y cursor', async () => {
    const all = (await t.as(cashier).get(path(cafe, '/sales?limit=200'))).body.map((s: unknown) => saleSchema.parse(s)) as SaleDto[];
    expect(all.length).toBeGreaterThan(3);
    const page1 = (await t.as(cashier).get(path(cafe, '/sales?limit=2'))).body as SaleDto[];
    const page2 = (await t.as(cashier).get(path(cafe, `/sales?limit=2&cursor=${saleCursor(page1[1]!)}`))).body as SaleDto[];
    expect([...page1, ...page2].map((s) => s.id)).toEqual(all.slice(0, 4).map((s) => s.id));
    const completed = (await t.as(cashier).get(path(cafe, '/sales?status=completed'))).body as SaleDto[];
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every((s) => s.status === 'completed')).toBe(true);
    expect((await t.as(cashier).get(path(cafe, '/sales?cursor=basura'))).status).toBe(400);
    // Pasa la forma del cursor pero la fecha es imposible o no canónica: 400, nunca un Invalid Date hacia la base.
    for (const ts of ['2026-99-99T99:99:99Z', '2026-02-30T10:00:00.000Z', '2026-11-14T10:00:00Z']) {
      expect((await t.as(cashier).get(path(cafe, `/sales?cursor=${ts}_${all[0]!.id}`))).status).toBe(400);
    }
  });
});

describe('POS-15: vínculos externos genéricos', () => {
  it('recurso conocido abre venta (201) y repetir devuelve la misma (200); desconocido o proveedor ausente 404', async () => {
    const resourceId = newId();
    t.validator.known.add(`desk:${resourceId}`);
    const body = { provider: 'ext', resource_type: 'desk', resource_id: resourceId };
    const link = (b: object, headers: Record<string, string> = key(), who = cashier) => t.as(who).post(path(cafe, '/links'), b, headers);
    expect((await link(body, {})).status).toBe(400);
    const firstKey = key();
    const first = await link(body, firstKey);
    const again = await link(body);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(result(again).sale.id).toBe(result(first).sale.id);
    expect(result(first).sale.context_label).toBe(`desk ${resourceId.slice(-4)}`);
    expect((await link({ ...body, resource_id: newId() })).status).toBe(404);
    expect((await link({ ...body, provider: 'otro' })).status).toBe(404);
    expect((await link({ ...body, provider: 'Ext!' })).status).toBe(400);
    expect((await link(body, key(), staff)).status).toBe(403);

    // Anulada la venta: un reintento tardío con la misma clave la devuelve; una petición nueva abre otra.
    await t.as(admin).post(path(cafe, `/sales/${result(first).sale.id}/void`), undefined, key());
    const late = await link(body, firstKey);
    expect([late.status, result(late).sale.id, result(late).sale.status]).toEqual([200, result(first).sale.id, 'voided']);
    const next = await link(body);
    expect(next.status).toBe(201);
    expect(result(next).sale.id).not.toBe(result(first).sale.id);
  });
});
