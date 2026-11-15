import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_API_PATHS as P } from '@modivara/analytics-contracts';
import { startHost } from './testing.js';

// Codex #1: el backend aplica los permisos efectivos de /me. Una métrica cuya fuente está suspendida responde 403 aunque se llame
// directo, sin pasar por el portal.
let host: Awaited<ReturnType<typeof startHost>>;
beforeAll(async () => { host = await startHost(); });
afterAll(() => host.app.close());

const q = '?range=today';

describe('permisos efectivos en el backend', () => {
  it('suspender commerce → métricas de inventario 403; suspender hospitality → métricas de llamados 403', async () => {
    const { as, locationId, organizationId } = host;
    const metrics = (path: string) => path.replace(':locationId', locationId) + q;
    const module = (name: string, enabled: boolean) => as('labs/superadmin').put(`/platform/organizations/${organizationId}/modules/${name}`, { enabled });
    for (const who of ['bar-demo/inventario1', 'bar-demo/admin']) expect((await as(who).get(metrics(P.inventoryMetrics))).status).toBe(200);
    expect((await as('bar-demo/admin').get(metrics(P.serviceCallMetrics))).status).toBe(200);

    expect((await module('commerce', false)).status).toBe(200);
    for (const who of ['bar-demo/inventario1', 'bar-demo/admin']) {
      const res = await as(who).get(metrics(P.inventoryMetrics));
      expect([who, res.status, res.body.code]).toEqual([who, 403, 'module_disabled']);
    }
    expect((await as('bar-demo/admin').get(metrics(P.serviceCallMetrics))).status).toBe(200);

    expect((await module('hospitality', false)).status).toBe(200);
    const calls = await as('bar-demo/admin').get(metrics(P.serviceCallMetrics));
    expect([calls.status, calls.body.code]).toEqual([403, 'module_disabled']);

    // Reactivar devuelve el acceso.
    await module('commerce', true);
    await module('hospitality', true);
    expect((await as('bar-demo/inventario1').get(metrics(P.inventoryMetrics))).status).toBe(200);
    expect((await as('bar-demo/admin').get(metrics(P.serviceCallMetrics))).status).toBe(200);
  });
});
