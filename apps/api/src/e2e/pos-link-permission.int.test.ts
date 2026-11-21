import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, SESSION_COOKIE, type MeResponse } from '@modivara/core-contracts';
import { IDEMPOTENCY_KEY_HEADER, saleResultSchema } from '@modivara/pos-contracts';
import { PASSWORD, startHost } from './testing.js';

// D1/D5/D2 (POS-C07): vincular una venta a una mesa exige `hospitality.tables.link_sale` (404 uniforme si falta o si la mesa no es del actor);
// cambiar la moneda con ventas abiertas es 409 `currency_locked`. Host completo, bases reales.
let h: Awaited<ReturnType<typeof startHost>>;
let table: string;
let soloPos: { locationId: string; cookie: string };
const key = () => ({ [IDEMPOTENCY_KEY_HEADER]: crypto.randomUUID() });
const pos = (loc = h.locationId) => `/locations/${loc}/pos`;
const link = (resourceId: string, who = 'bar-demo/caja1') =>
  h.as(who).post(`${pos()}/links`, { provider: 'hospitality', resource_type: 'table', resource_id: resourceId }, key());

async function loginCookie(slug: string, username: string) {
  const res = await request(h.app.getHttpServer()).post('/api/v1/auth/login').send({ slug, username, password: PASSWORD });
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!.split(';')[0]!;
}

beforeAll(async () => {
  h = await startHost();
  table = ((await h.as('bar-demo/admin').get(`/locations/${h.locationId}/tables`)).body as Array<{ id: string; label: string }>).find((t) => t.label === '1')!.id;

  // Negocio solo POS (tienda-demo): su admin crea un cajero.
  const adminCookie = await loginCookie('tienda-demo', 'admin');
  const api = (c: string) => ({
    get: (p: string) => request(h.app.getHttpServer()).get(`/api/v1${p}`).set('Cookie', c),
    post: (p: string, b?: object) => request(h.app.getHttpServer()).post(`/api/v1${p}`).set('Cookie', c).send(b),
    put: (p: string, b: object) => request(h.app.getHttpServer()).put(`/api/v1${p}`).set('Cookie', c).send(b),
  });
  const locationId = ((await api(adminCookie).get('/me')).body as MeResponse).locations[0]!.id;
  const user = (await api(adminCookie).post('/users', { username: 'caja-sola', display_name: 'Caja Sola', password: PASSWORD })).body as { id: string };
  expect((await api(adminCookie).put(`/users/${user.id}/locations/${locationId}/roles`, { roles: ['cashier'] })).status).toBe(200);
  soloPos = { locationId, cookie: await loginCookie('tienda-demo', 'caja-sola') };
});
afterAll(() => h.app.close());

describe('permiso hospitality.tables.link_sale al vincular', () => {
  it('cajero con el permiso vincula la mesa; /me lo lista y lee mesas y zonas, pero no llamados ni dispositivos', async () => {
    const me = (await h.as('bar-demo/caja1').get('/me')).body as MeResponse;
    expect(me.locations[0]!.permissions).toContain('hospitality.tables.link_sale');
    expect(me.locations[0]!.permissions).not.toContain('hospitality.calls.read');
    const res = await link(table);
    expect(res.status).toBe(201);
    expect(saleResultSchema.parse(res.body).sale.context_label).toBe('1');
    const caja = h.as('bar-demo/caja1');
    expect((await caja.get(`/locations/${h.locationId}/tables`)).status).toBe(200);
    expect((await caja.get(`/locations/${h.locationId}/zones`)).status).toBe(200);
    expect((await caja.get(`/locations/${h.locationId}/service-calls`)).status).toBe(403);
    expect((await caja.get(`/locations/${h.locationId}/device-status`)).status).toBe(403);
  });

  it('pos.sales.operate sin link_sale → 404, igual que una mesa inexistente', async () => {
    const original = ROLE_PERMISSIONS.cashier;
    (ROLE_PERMISSIONS as { cashier: unknown }).cashier = original.filter((p) => p !== 'hospitality.tables.link_sale');
    try {
      const denied = await link(table);
      const missing = await link(crypto.randomUUID());
      expect(denied.status).toBe(404);
      expect(denied.body).toEqual(missing.body);
    } finally {
      (ROLE_PERMISSIONS as { cashier: unknown }).cashier = original;
    }
  });

  it('cajero de un negocio solo POS (sin Hospitality) → 404 aunque la mesa exista en otro negocio', async () => {
    const me = await request(h.app.getHttpServer()).get('/api/v1/me').set('Cookie', soloPos.cookie);
    expect((me.body as MeResponse).locations[0]!.permissions).not.toContain('hospitality.tables.link_sale');
    const res = await request(h.app.getHttpServer()).post(`/api/v1${pos(soloPos.locationId)}/links`).set('Cookie', soloPos.cookie).set(key())
      .send({ provider: 'hospitality', resource_type: 'table', resource_id: table });
    expect(res.status).toBe(404);
  });

  it('mesa de otro negocio enviada por un actor con local propio → 404', async () => {
    const pisos = h.as('bar-demo-pisos/admin');
    const pisosLoc = ((await pisos.get('/me')).body as MeResponse).locations[0]!.id;
    const foreign = (await pisos.post(`/locations/${pisosLoc}/tables`, { label: 'AJENA' })).body as { id: string };
    expect((await link(foreign.id)).status).toBe(404);
  });
});

describe('cambio de moneda (D2)', () => {
  it('con una venta abierta → 409 currency_locked; sin ventas abiertas se puede cambiar', async () => {
    const admin = h.as('bar-demo/admin');
    const open = (await link(table)).body; // la venta de la mesa sigue abierta
    expect(saleResultSchema.parse(open).sale.status).toBe('open');
    const blocked = await admin.put(`${pos()}/settings`, { currency: 'USD' });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: 'currency_locked' });

    const saleId = saleResultSchema.parse(open).sale.id;
    expect((await admin.post(`${pos()}/sales/${saleId}/void`, {}, key())).status).toBe(201);
    const ok = await admin.put(`${pos()}/settings`, { currency: 'USD' });
    expect([ok.status, ok.body]).toEqual([200, { currency: 'USD' }]);
  });
});
