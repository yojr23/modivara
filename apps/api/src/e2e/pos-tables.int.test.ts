import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_KEY_HEADER, saleResultSchema, saleSchema } from '@modivara/pos-contracts';
import { startHost } from './testing.js';

// POS-27 / POS-28 / POS-42: adaptador de mesas de Hospitality en el host completo, con mesas, botón y llamados reales.
let h: Awaited<ReturnType<typeof startHost>>;
let table: string;
const key = () => ({ [IDEMPOTENCY_KEY_HEADER]: crypto.randomUUID() });
const pos = () => `/locations/${h.locationId}/pos`;
const link = (resourceId: string, who = 'bar-demo/caja1', headers = key(), resourceType = 'table') =>
  h.as(who).post(`${pos()}/links`, { provider: 'hospitality', resource_type: resourceType, resource_id: resourceId }, headers);
const coreDb = () => h.get<{ $executeRawUnsafe(sql: string): Promise<unknown> }>('CORE_PRISMA');

beforeAll(async () => {
  h = await startHost();
  // La mesa «1» de startHost tiene el botón btn-01 asignado.
  table = ((await h.as('bar-demo/admin').get(`/locations/${h.locationId}/tables`)).body as Array<{ id: string; label: string }>).find((t) => t.label === '1')!.id;
});
afterAll(() => h.app.close());

describe('vincular una venta a una mesa (adaptador hospitality)', () => {
  it('mesa activa del local: abre venta; otra petición para la misma mesa recibe la misma venta', async () => {
    const first = await link(table);
    expect(first.status).toBe(201);
    const again = await link(table, 'bar-demo/admin');
    expect(again.status).toBe(200);
    const sale = saleResultSchema.parse(again.body).sale;
    expect(sale.id).toBe(saleResultSchema.parse(first.body).sale.id);
    // Caja (sin permisos de Hospitality) reconoce la mesa por la etiqueta de la venta, en el detalle y en el listado.
    expect(sale.context_label).toBe('1');
    const caja = h.as('bar-demo/caja1');
    expect(saleSchema.parse((await caja.get(`${pos()}/sales/${sale.id}`)).body).context_label).toBe('1');
    const open = saleSchema.array().parse((await caja.get(`${pos()}/sales?status=open`)).body);
    expect(open.find((s) => s.id === sale.id)?.context_label).toBe('1');
  });

  it('mesa inexistente, de otro local, desactivada o tipo de recurso ajeno: 404', async () => {
    expect((await link(crypto.randomUUID())).status).toBe(404);
    expect((await link(table, 'bar-demo/caja1', key(), 'zone')).status).toBe(404);

    const pisosMe = (await h.as('bar-demo-pisos/admin').get('/me')).body as { locations: Array<{ id: string }> };
    const pisosTable = (await h.as('bar-demo-pisos/admin').post(`/locations/${pisosMe.locations[0]!.id}/tables`, { label: 'P-POS' })).body as { id: string };
    expect((await link(pisosTable.id)).status).toBe(404);

    const spare = (await h.as('bar-demo/admin').post(`/locations/${h.locationId}/tables`, { label: 'POS-baja' })).body as { id: string };
    expect((await h.as('bar-demo/admin').post(`/locations/${h.locationId}/tables/${spare.id}/deactivate`)).status).toBe(204);
    expect((await link(spare.id)).status).toBe(404);
  });

  it('negocio sin el módulo hospitality: la mesa no existe para POS', async () => {
    const set = (enabled: boolean) =>
      coreDb().$executeRawUnsafe(`UPDATE entitlements SET enabled = ${enabled} WHERE module = 'hospitality' AND organization_id = '${h.organizationId}'`);
    await set(false);
    try {
      expect((await link(table)).status).toBe(404);
    } finally {
      await set(true);
    }
  });

  it('reintento con la misma clave tras desactivar la mesa o revocar hospitality: la venta ya confirmada', async () => {
    const admin = h.as('bar-demo/admin');
    const spare = (await admin.post(`/locations/${h.locationId}/tables`, { label: 'POS-reintento' })).body as { id: string };
    const headers = key();
    const first = await link(spare.id, 'bar-demo/caja1', headers);
    expect(first.status).toBe(201);
    const saleId = saleResultSchema.parse(first.body).sale.id;

    expect((await admin.post(`/locations/${h.locationId}/tables/${spare.id}/deactivate`)).status).toBe(204);
    const afterDeactivate = await link(spare.id, 'bar-demo/caja1', headers);
    expect([afterDeactivate.status, saleResultSchema.parse(afterDeactivate.body).sale.id]).toEqual([200, saleId]);
    expect((await link(spare.id)).status).toBe(404); // una petición nueva sí se valida

    await coreDb().$executeRawUnsafe(`UPDATE entitlements SET enabled = false WHERE module = 'hospitality' AND organization_id = '${h.organizationId}'`);
    try {
      const afterRevoke = await link(spare.id, 'bar-demo/caja1', headers);
      expect([afterRevoke.status, saleResultSchema.parse(afterRevoke.body).sale.id]).toEqual([200, saleId]);
    } finally {
      await coreDb().$executeRawUnsafe(`UPDATE entitlements SET enabled = true WHERE module = 'hospitality' AND organization_id = '${h.organizationId}'`);
    }
  });

  it('el llamado y la venta de la mesa son independientes', async () => {
    const admin = h.as('bar-demo/admin');
    const callOf = async (id: string) => (await admin.get(`/locations/${h.locationId}/service-calls/${id}`)).body.status as string;
    const saleOf = async (id: string) => (await admin.get(`${pos()}/sales/${id}`)).body.status as string;
    const saleId = saleResultSchema.parse((await link(table)).body).sale.id; // la abierta del primer caso

    const callA = (await h.press()).body.service_call_id as string;
    expect(await callOf(callA)).toBe('pending');
    expect((await admin.post(`/locations/${h.locationId}/service-calls/${callA}/acknowledge`)).status).toBe(200);
    expect((await admin.post(`/locations/${h.locationId}/service-calls/${callA}/complete`)).status).toBe(200);
    expect(await saleOf(saleId)).toBe('open');

    await new Promise((r) => setTimeout(r, 3_100)); // ventana anti-rebote del botón (3 s)
    const callB = (await h.press()).body.service_call_id as string;
    expect(callB).not.toBe(callA);
    const item = (await admin.post(`${pos()}/items`, { name: 'Cerveza mesa', unit: 'unit', price: '9000' })).body as { id: string };
    expect((await h.as('bar-demo/caja1').post(`${pos()}/sales/${saleId}/lines`, { sellable_item_id: item.id, quantity: '2' }, key())).status).toBe(201);
    expect((await h.as('bar-demo/caja1').post(`${pos()}/sales/${saleId}/complete`, { payment_method: 'cash' }, key())).status).toBe(201);
    expect(await callOf(callB)).toBe('pending');

    // Cerrada la venta, la mesa queda libre para una cuenta nueva.
    const next = await link(table);
    expect(next.status).toBe(201);
    expect(saleResultSchema.parse(next.body).sale.id).not.toBe(saleId);
  });
});
