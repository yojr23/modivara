import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, permissionsFor, type RequestActor } from '@modivara/core-contracts';
import {
  balanceSchema, movementReasonSchema, movementSchema, productSchema, recordedMovementSchema, stockLocationSchema,
} from '@modivara/commerce-contracts';
import { EnsureDefaultStockLocation } from '../application/index.js';
import { createCommerceTestApp, type TestCaller } from '../testing/http.js';

let t: Awaited<ReturnType<typeof createCommerceTestApp>>;
const orgA = newId(), orgB = newId(), locA1 = newId(), locA2 = newId(), locB = newId();

const actor = (organizationId: string, over: Partial<RequestActor> = {}): RequestActor => ({
  actorUserId: newId(), organizationId, isPlatform: false, isOwner: false, sessionId: newId(), actingOrganizationId: null, ...over,
});
const perms = (role: 'admin' | 'staff' | 'inventory') => [...permissionsFor([role], { isOwner: false, isPlatform: false })];
const caller = (role: 'admin' | 'staff' | 'inventory', locs = [locA1], organizationId = orgA): TestCaller => ({
  actor: actor(organizationId), permissions: Object.fromEntries(locs.map((l) => [l, perms(role)])), modules: ['commerce'],
});
const admin = caller('admin');
const inventory = caller('inventory');
const staff = caller('staff');
const adminNoModule: TestCaller = { ...admin, modules: ['hospitality'] };
const adminBoth = caller('admin', [locA1, locA2]);
const adminB = caller('admin', [locB], orgB);

beforeAll(async () => {
  t = await createCommerceTestApp();
  for (const [id, organizationId] of [[locA1, orgA], [locA2, orgA], [locB, orgB]] as const) t.core.add({ id, organizationId });
  // «Principal» lo crea el suscriptor de core.location.created; aquí se simula con el mismo caso de uso.
  const ensure = new EnsureDefaultStockLocation(t.repos.stockLocations, t.core);
  for (const [locationId, organizationId] of [[locA1, orgA], [locA2, orgA]] as const) await ensure.execute({ organizationId, locationId, actorUserId: newId() });
});
afterAll(() => t.app.close());

const base = `/locations/${locA1}`;
const key = () => ({ 'Idempotency-Key': newId() });

async function world() {
  const compra = movementReasonSchema.parse((await t.as(admin).post('/commerce/movement-reasons', { name: `Compra ${newId()}`, direction: 'in' })).body);
  const venta = movementReasonSchema.parse((await t.as(admin).post('/commerce/movement-reasons', { name: `Venta ${newId()}`, direction: 'out' })).body);
  const ajuste = movementReasonSchema.parse((await t.as(admin).post('/commerce/movement-reasons', { name: `Ajuste ${newId()}`, direction: 'adjust' })).body);
  const place = stockLocationSchema.parse((await t.as(inventory).get(`${base}/stock-locations`)).body[0]);
  const product = productSchema.parse((await t.as(inventory).post(`${base}/products`, { name: `Cerveza ${newId()}`, unit: 'bottle' })).body);
  const move = (body: object, headers: Record<string, string> = key(), who = inventory) => t.as(who).post(`${base}/stock/movements`, body, headers);
  const entry = (quantity: string, headers?: Record<string, string>) =>
    move({ stock_location_id: place.id, product_id: product.id, reason_id: compra.id, direction: 'in', quantity }, headers);
  return { compra, venta, ajuste, place, product, move, entry };
}

describe('F4-07 catálogo, lugares y motivos', () => {
  it('inventory gestiona el catálogo; staff recibe 403; sin módulo 403; admin todo', async () => {
    const created = await t.as(inventory).post(`${base}/products`, { name: 'Ron', sku: 'R1', unit: 'bottle' });
    expect(created.status).toBe(201);
    const p = productSchema.parse(created.body);
    expect(p).toMatchObject({ name: 'Ron', sku: 'R1', active: true });
    expect((await t.as(inventory).patch(`${base}/products/${p.id}`, { category: 'Licores' })).body).toMatchObject({ category: 'Licores' });
    expect((await t.as(inventory).get(`${base}/products`)).body.some((x: { id: string }) => x.id === p.id)).toBe(true);
    expect((await t.as(inventory).post(`${base}/stock-locations`, { name: 'Barra' })).status).toBe(201);

    expect((await t.as(staff).get(`${base}/products`)).status).toBe(403);
    expect((await t.as(staff).post(`${base}/products`, { name: 'X', unit: 'unit' })).status).toBe(403);
    expect((await t.as(staff).get(`${base}/stock-locations`)).status).toBe(403);
    expect((await t.as(staff).get('/commerce/movement-reasons')).status).toBe(403);
    expect((await t.as(adminNoModule).get(`${base}/products`)).body).toMatchObject({ code: 'module_disabled' });
    expect((await t.as(admin).post(`${base}/products/${p.id}/deactivate`)).status).toBe(204);
    expect((await t.as(admin).get(`${base}/products`)).body.find((x: { id: string }) => x.id === p.id)).toMatchObject({ active: false });
  });

  it('duplicados 409; cuerpo inválido 400; el tenant no sale del cuerpo', async () => {
    await t.as(admin).post(`${base}/products`, { name: 'Vodka', unit: 'bottle' });
    const dup = await t.as(admin).post(`${base}/products`, { name: ' VODKA ', unit: 'bottle' });
    expect([dup.status, dup.body.code]).toEqual([409, 'conflict']);
    expect((await t.as(admin).post(`${base}/products`, { name: '', unit: 'bottle' })).status).toBe(400);
    expect((await t.as(admin).post(`${base}/products`, { name: 'Gin', unit: 'galon' })).status).toBe(400);
    const smuggled = await t.as(admin).post(`${base}/products`, { name: 'Whisky', unit: 'bottle', organization_id: orgB, location_id: locB });
    expect(smuggled.status).toBe(201);
    expect((await t.as(adminB).get(`/locations/${locB}/products`)).body).toEqual([]);
  });

  it('motivos: inventory los lee pero no los gestiona; admin crea, duplicado 409 y desactiva', async () => {
    const r = movementReasonSchema.parse((await t.as(admin).post('/commerce/movement-reasons', { name: 'Regalo', direction: 'out' })).body);
    expect((await t.as(admin).post('/commerce/movement-reasons', { name: 'regalo', direction: 'out' })).status).toBe(409);
    expect((await t.as(inventory).post('/commerce/movement-reasons', { name: 'X', direction: 'in' })).status).toBe(403);
    expect((await t.as(inventory).post(`/commerce/movement-reasons/${r.id}/deactivate`)).status).toBe(403);
    expect((await t.as(inventory).get('/commerce/movement-reasons')).body.some((x: { id: string }) => x.id === r.id)).toBe(true);
    expect((await t.as(admin).post(`/commerce/movement-reasons/${r.id}/deactivate`)).status).toBe(204);
    expect((await t.as(admin).post(`/commerce/movement-reasons/${newId()}/deactivate`)).status).toBe(404);
    expect((await t.as(adminB).get('/commerce/movement-reasons')).body).toEqual([]);
  });

  it('local de otro negocio o sin permiso: 404; id de ruta inválido: 400', async () => {
    expect((await t.as(adminB).get(`${base}/products`)).status).toBe(404);
    expect((await t.as(admin).get(`/locations/${locA2}/products`)).status).toBe(404);
    expect((await t.as(admin).patch(`${base}/products/no-es-uuid`, { name: 'x' })).status).toBe(400);
  });
});

describe('F4-07 movimientos y saldos', () => {
  it('inventory registra entrada, salida y ajuste por conteo; saldos e historial coinciden', async () => {
    const w = await world();
    const entry = await w.entry('10');
    expect(entry.status).toBe(201);
    expect(recordedMovementSchema.parse(entry.body)).toMatchObject({ replayed: false, movement: { delta: '10.000', balance_after: '10.000' } });
    const out = await w.move({ stock_location_id: w.place.id, product_id: w.product.id, reason_id: w.venta.id, direction: 'out', quantity: '3', note: 'mesa 4' });
    expect(recordedMovementSchema.parse(out.body).movement).toMatchObject({ delta: '-3.000', balance_after: '7.000', note: 'mesa 4' });
    const count = await t.as(inventory).post(`${base}/stock/count-adjustments`, {
      stock_location_id: w.place.id, product_id: w.product.id, reason_id: w.ajuste.id, counted_quantity: '5',
    }, key());
    expect(count.status).toBe(201);
    expect(recordedMovementSchema.parse(count.body).movement).toMatchObject({ direction: 'adjust', delta: '-2.000', balance_after: '5.000' });

    const balances = (await t.as(inventory).get(`${base}/stock/balances?product_id=${w.product.id}`)).body.map((b: unknown) => balanceSchema.parse(b));
    expect(balances).toMatchObject([{ product_id: w.product.id, quantity: '5.000' }]);
    const history = (await t.as(inventory).get(`${base}/stock/movements?product_id=${w.product.id}&limit=2`)).body.map((m: unknown) => movementSchema.parse(m));
    expect(history.map((m: { delta: string }) => m.delta)).toEqual(['-2.000', '-3.000']);
  });

  it('saldo insuficiente: 409 con code propio y sin dejar movimiento', async () => {
    const w = await world();
    await w.entry('2');
    const out = await w.move({ stock_location_id: w.place.id, product_id: w.product.id, reason_id: w.venta.id, direction: 'out', quantity: '2.5' });
    expect(out.status).toBe(409);
    expect(out.body).toMatchObject({ code: 'insufficient_stock' });
    expect((await t.as(inventory).get(`${base}/stock/movements?product_id=${w.product.id}`)).body).toHaveLength(1);
  });

  it('Idempotency-Key obligatoria y con formato uuid; repetida devuelve el original con 200', async () => {
    const w = await world();
    expect((await w.entry('1', {})).status).toBe(400);
    expect((await w.entry('1', { 'Idempotency-Key': 'abc' })).status).toBe(400);
    const headers = key();
    const first = await w.entry('4', headers);
    const again = await w.entry('4', headers);
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body).toMatchObject({ replayed: true, movement: { id: first.body.movement.id } });
    expect((await t.as(inventory).get(`${base}/stock/balances?product_id=${w.product.id}`)).body[0].quantity).toBe('4.000');
  });

  it('la misma clave en otro local del mismo negocio: 409 y sin datos del otro movimiento', async () => {
    const w = await world();
    // El mismo admin opera en dos locales; el producto/lugar del local 2 se crean allí.
    const base2 = `/locations/${locA2}`;
    const place2 = stockLocationSchema.parse((await t.as(adminBoth).get(`${base2}/stock-locations`)).body[0]);
    const product2 = productSchema.parse((await t.as(adminBoth).post(`${base2}/products`, { name: 'Cerveza B', unit: 'bottle' })).body);
    const headers = key();
    const other = await t.as(adminBoth).post(`${base2}/stock/movements`, {
      stock_location_id: place2.id, product_id: product2.id, reason_id: w.compra.id, direction: 'in', quantity: '77',
    }, headers);
    expect(other.status).toBe(201);
    const clash = await w.entry('1', headers);
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('idempotency_key_reused');
    expect(JSON.stringify(clash.body)).not.toContain(other.body.movement.id);
    expect(JSON.stringify(clash.body)).not.toContain('77');
    expect((await t.as(inventory).get(`${base}/stock/movements?product_id=${w.product.id}`)).body).toEqual([]);
  });

  it('producto o lugar de otro local/negocio: 404; motivo de otra dirección: 400; cantidad inválida: 400', async () => {
    const w = await world();
    const foreignProduct = productSchema.parse((await t.as(adminBoth).post(`/locations/${locA2}/products`, { name: `Ajeno ${newId()}`, unit: 'unit' })).body);
    const body = { stock_location_id: w.place.id, product_id: w.product.id, reason_id: w.compra.id, direction: 'in', quantity: '1' };
    expect((await w.move({ ...body, product_id: foreignProduct.id })).status).toBe(404);
    expect((await w.move({ ...body, stock_location_id: newId() })).status).toBe(404);
    expect((await w.move({ ...body, reason_id: newId() })).status).toBe(404);
    expect((await w.move({ ...body, direction: 'out' })).body).toMatchObject({ code: 'reason_direction_mismatch' });
    expect((await w.move({ ...body, quantity: '-1' })).status).toBe(400);
    expect((await w.move({ ...body, quantity: '1.0001' })).status).toBe(400);
    expect((await w.move({ ...body, quantity: 1 })).status).toBe(400);
    expect((await w.move(body, key(), adminB)).status).toBe(404); // negocio ajeno: ni el local existe
  });

  it('staff 403 y sin módulo 403; admin puede todo; contado igual al saldo 400', async () => {
    const w = await world();
    await w.entry('3');
    const body = { stock_location_id: w.place.id, product_id: w.product.id, reason_id: w.compra.id, direction: 'in', quantity: '1' };
    expect((await w.move(body, key(), staff)).status).toBe(403);
    expect((await t.as(staff).get(`${base}/stock/balances`)).status).toBe(403);
    expect((await t.as(staff).get(`${base}/stock/movements`)).status).toBe(403);
    expect((await t.as(staff).post(`${base}/stock/count-adjustments`, {}, key())).status).toBe(403);
    expect((await w.move(body, key(), adminNoModule)).body).toMatchObject({ code: 'module_disabled' });
    expect((await w.move(body, key(), admin)).status).toBe(201);
    const same = await t.as(admin).post(`${base}/stock/count-adjustments`, {
      stock_location_id: w.place.id, product_id: w.product.id, reason_id: w.ajuste.id, counted_quantity: '4',
    }, key());
    expect([same.status, same.body.code]).toEqual([400, 'invalid_movement']);
  });
});
