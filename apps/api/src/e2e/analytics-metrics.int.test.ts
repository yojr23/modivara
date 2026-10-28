import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_API_PATHS as P, inventoryMetricsSchema, serviceCallMetricsSchema } from '@modivara/analytics-contracts';
import { newId } from '@modivara/core-contracts';
import { startHost } from './testing.js';

// F5-07: permisos, módulo, local ajeno y validación de la API de métricas por el host real.
let host: Awaited<ReturnType<typeof startHost>>;
beforeAll(async () => { host = await startHost(); });
afterAll(() => host.app.close());

const url = (path: string, locationId: string) => path.replace(':locationId', locationId);
const q = '?range=today';

describe('F5-07 API de métricas', () => {
  it('admin ve ambas; el cuerpo valida contra el esquema de respuesta', async () => {
    const { as, locationId } = host;
    await host.analyticsDb.$executeRawUnsafe(
      `INSERT INTO service_call_facts (service_call_id, organization_id, location_id, table_id, table_label, call_type, created_at, press_count)
       VALUES ('${newId()}', '${host.organizationId}', '${locationId}', '${newId()}', 'M1', 'attention', now(), 1)`,
    );
    const calls = await as('bar-demo/admin').get(url(P.serviceCallMetrics, locationId) + q);
    expect(calls.status).toBe(200);
    expect(serviceCallMetricsSchema.parse(calls.body).totals.calls).toBe(1);
    const inv = await as('bar-demo/admin').get(url(P.inventoryMetrics, locationId) + q + '&group_by=hour');
    expect(inv.status).toBe(200);
    expect(inventoryMetricsSchema.parse(inv.body).group_by).toBe('hour');
  });

  it('inventory solo ve inventario; staff recibe 403 en ambas', async () => {
    const { as, locationId } = host;
    expect((await as('bar-demo/inventario1').get(url(P.inventoryMetrics, locationId) + q)).status).toBe(200);
    expect((await as('bar-demo/inventario1').get(url(P.serviceCallMetrics, locationId) + q)).status).toBe(403);
    expect((await as('bar-demo/barra').get(url(P.serviceCallMetrics, locationId) + q)).status).toBe(403);
    expect((await as('bar-demo/barra').get(url(P.inventoryMetrics, locationId) + q)).status).toBe(403);
  });

  it('el local de otro negocio es 404 y un id mal formado, 400', async () => {
    const { as, get, organizationId } = host;
    const [other] = await get<{ $queryRawUnsafe<T>(sql: string): Promise<T> }>('CORE_PRISMA').$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM locations WHERE organization_id <> '${organizationId}' LIMIT 1`,
    );
    const foreign = other!.id;
    expect((await as('bar-demo/admin').get(url(P.serviceCallMetrics, foreign) + q)).status).toBe(404);
    expect((await as('bar-demo/admin').get(url(P.inventoryMetrics, foreign) + q)).status).toBe(404);
    expect((await as('bar-demo/admin').get(url(P.inventoryMetrics, 'no-uuid') + q)).status).toBe(400);
  });

  it('rango o filtros inválidos son 400', async () => {
    const { as, locationId } = host;
    const base = url(P.serviceCallMetrics, locationId);
    for (const bad of ['', '?range=last_year', '?range=custom', '?range=custom&from=2026-10-02&to=2026-10-01', '?range=today&group_by=week', '?range=today&zone_id=x']) {
      const res = await as('bar-demo/admin').get(base + bad);
      expect([bad, res.status]).toEqual([bad, 400]);
    }
  });

  it('con el módulo deshabilitado es 403', async () => {
    const { as, locationId, get } = host;
    const base = url(P.serviceCallMetrics, locationId) + q;
    expect((await as('bar-demo/admin').get(base)).status).toBe(200);
    await get<{ $executeRawUnsafe(sql: string): Promise<unknown> }>('CORE_PRISMA').$executeRawUnsafe(
      `UPDATE entitlements SET enabled = false WHERE module = 'analytics' AND organization_id = '${host.organizationId}'`,
    );
    const res = await as('bar-demo/admin').get(base);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'module_disabled' });
    expect((await as('bar-demo/admin').get(url(P.inventoryMetrics, locationId) + q)).status).toBe(403);
  });
});
