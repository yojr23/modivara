import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_EVENT_SUBSCRIBER } from '@modivara/analytics-api';
import type { IntegrationEventSubscriber } from '@modivara/core-contracts';
import { serviceCallPageSchema, serviceCallSchema } from '@modivara/hospitality-contracts';
import { startHost } from './testing.js';

// F5-09 (Vitest, sin Playwright: decisión del responsable 25/10): si analytics falla, la operación de hospitality no se entera.
let host: Awaited<ReturnType<typeof startHost>>;
beforeAll(async () => { host = await startHost(); });
afterAll(() => host.app.close());

const outbox = () => host.hospitalityDb.$queryRawUnsafe<Array<{ attempts: number; dispatched_at: Date | null }>>('SELECT attempts, dispatched_at FROM outbox_events');
const facts = () => host.analyticsDb.$queryRawUnsafe<Array<{ press_count: number; completed_at: Date | null }>>('SELECT press_count, completed_at FROM service_call_facts');

describe('F5-09 aislamiento operativo con analytics fallando', () => {
  it('pulsar, reconocer, finalizar y leer activos siguen funcionando; al recuperarse analytics se pone al día', async () => {
    const { as, locationId } = host;
    const subscriber = host.get<IntegrationEventSubscriber>(ANALYTICS_EVENT_SUBSCRIBER);
    const broken = vi.spyOn(subscriber, 'handle').mockRejectedValue(new Error('analytics caído'));

    expect((await host.press()).status).toBe(200);
    const active = serviceCallPageSchema.parse((await as('bar-demo/barra').get(`/locations/${locationId}/service-calls`)).body);
    expect(active.items).toHaveLength(1);
    const base = `/locations/${locationId}/service-calls/${active.items[0]!.id}`;
    expect(serviceCallSchema.parse((await as('bar-demo/barra').post(`${base}/acknowledge`)).body).status).toBe('in_progress');
    expect(serviceCallSchema.parse((await as('bar-demo/barra').post(`${base}/complete`)).body).status).toBe('completed');
    expect(serviceCallPageSchema.parse((await as('bar-demo/barra').get(`/locations/${locationId}/service-calls`)).body).items).toHaveLength(0);

    // El poller entrega, analytics lanza: los eventos quedan sin despachar con un intento más y no hay facts.
    await host.tickHospitality();
    expect(broken).toHaveBeenCalled();
    expect(await outbox()).toEqual([1, 1, 1].map((attempts) => ({ attempts, dispatched_at: null })));
    expect(await facts()).toHaveLength(0);

    // Analytics se recupera; se salta la espera del backoff y los siguientes ticks despachan todo (created, acknowledged, completed).
    broken.mockRestore();
    await host.hospitalityDb.$executeRawUnsafe('UPDATE outbox_events SET next_attempt_at = now()');
    await host.tickHospitality();
    expect((await outbox()).every((e) => e.dispatched_at !== null)).toBe(true);
    const rows = await facts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completed_at).not.toBeNull();
  });
});
