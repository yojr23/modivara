import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EVENT_SUBSCRIBER } from '@modivara/analytics-api';
import type { IntegrationEventSubscriber } from '@modivara/core-contracts';
import { startHost } from './testing.js';

// MOD-15/54/72 (T13): lo mismo que F5-09 (analytics-isolation) pero con un movimiento de commerce. Un consumidor caído no revierte ni bloquea
// el hecho original; el evento queda pendiente y, al recuperarse, se entrega una vez (reentregarlo no duplica el hecho de analytics).
let host: Awaited<ReturnType<typeof startHost>>;
beforeAll(async () => { host = await startHost(); });
afterAll(() => host.app.close());

type Raw = { $executeRawUnsafe(sql: string): Promise<unknown>; $queryRawUnsafe<T>(sql: string): Promise<T> };

describe('MOD-15/54/72 commerce con analytics fallando', () => {
  it('el movimiento se confirma y se lee; el evento queda sin despachar y luego se entrega una sola vez', async () => {
    const { as, locationId } = host;
    const commerceDb = host.get<Raw>('COMMERCE_PRISMA');
    await host.tickCommerce(); // despacha lo que dejó el seed
    const inv = as('bar-demo/inventario1');
    const [product] = (await inv.get(`/locations/${locationId}/products`)).body as Array<{ id: string }>;
    const [place] = (await inv.get(`/locations/${locationId}/stock-locations`)).body as Array<{ id: string }>;
    const compra = ((await inv.get('/commerce/movement-reasons')).body as Array<{ id: string; name: string }>).find((r) => r.name === 'Compra')!;
    const balance = async () => Number(((await inv.get(`/locations/${locationId}/stock/balances?product_id=${product!.id}`)).body as Array<{ quantity: string }>)[0]!.quantity);
    const before = await balance();

    const broken = vi.spyOn(host.get<IntegrationEventSubscriber>(ANALYTICS_EVENT_SUBSCRIBER), 'handle').mockRejectedValue(new Error('analytics caído'));
    const res = await inv.post(`/locations/${locationId}/stock/movements`, {
      stock_location_id: place!.id, product_id: product!.id, direction: 'in', reason_id: compra.id, quantity: '4',
    }, { 'Idempotency-Key': crypto.randomUUID() });
    expect(res.status).toBe(201);
    const movementId = (res.body as { movement: { id: string } }).movement.id;
    const outbox = () => commerceDb.$queryRawUnsafe<Array<{ attempts: number; dispatched_at: Date | null }>>(
      `SELECT attempts, dispatched_at FROM outbox_events WHERE aggregate_id = '${movementId}'`,
    );
    const facts = async () => (await host.analyticsDb.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM stock_movement_facts WHERE movement_id = '${movementId}'`)).length;

    await host.tickCommerce();
    expect(broken).toHaveBeenCalled();
    expect(await outbox()).toEqual([{ attempts: 1, dispatched_at: null }]);
    expect([await facts(), await balance()]).toEqual([0, before + 4]); // el hecho original está confirmado y legible

    broken.mockRestore();
    await commerceDb.$executeRawUnsafe('UPDATE outbox_events SET next_attempt_at = now()');
    await host.tickCommerce();
    expect((await outbox())[0]!.dispatched_at).not.toBeNull();
    expect(await facts()).toBe(1);

    // Reentrega (at-least-once, p. ej. caída tras entregar): analytics deduplica por event_id.
    await commerceDb.$executeRawUnsafe(`UPDATE outbox_events SET dispatched_at = NULL WHERE aggregate_id = '${movementId}'`);
    await host.tickCommerce();
    expect((await outbox())[0]!.dispatched_at).not.toBeNull();
    expect(await facts()).toBe(1);
  });
});
