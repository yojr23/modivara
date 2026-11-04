import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { analyticsPrismaForTests, resetAnalytics, tenant } from '../testing/integration.js';
import {
  PrismaProcessedEventStore, PrismaProjectionTransaction, PrismaServiceCallFactRepository, PrismaStockMovementFactRepository,
} from '../infrastructure/prisma/index.js';
import { AnalyticsEventSubscriber, buildEventRegistry, ProjectEvent, type ProjectionTransaction } from './index.js';
import type { ServiceCallFact } from '../domain/index.js';

// F5-03 contra PostgreSQL real: el orden de llegada no cambia el fact y un error transitorio se reintenta sin duplicar.
const db = analyticsPrismaForTests();
const t = tenant();
const CALL = newId();
beforeEach(() => resetAnalytics(db));
afterAll(() => db.$disconnect());

const env = (type: string, payload: object) => ({
  event_id: newId(), event_type: type, event_version: 1, occurred_at: '2026-10-19T15:00:00Z',
  organization_id: t.organizationId, location_id: t.locationId, aggregate_id: CALL, correlation_id: newId(), causation_id: null, payload,
});
const events = () => [
  env('hospitality.service_call.created', {
    service_call_id: CALL, table_id: newId(), table_label: 'M2', zone_id: null, zone_name: null, call_type: 'attention', created_at: '2026-10-19T15:00:00Z',
  }),
  env('hospitality.service_call.acknowledged', { service_call_id: CALL, acknowledged_at: '2026-10-19T15:01:00Z', acknowledged_by: newId(), press_count: 2 }),
  env('hospitality.service_call.completed', { service_call_id: CALL, completed_at: '2026-10-19T15:03:00Z', completed_by: newId(), press_count: 3 }),
];

/** Falla tras aplicar el fact, ya dentro de la transacción (caída entre aplicar y confirmar). */
let failures = 0;
class FlakyCalls extends PrismaServiceCallFactRepository {
  override async save(fact: ServiceCallFact) {
    await super.save(fact);
    if (failures-- > 0) throw new Error('conexión perdida');
  }
}
/** Réplica del cableado de producción, con el repositorio defectuoso dentro de la transacción. */
const flakyTransaction: ProjectionTransaction = {
  run: (work) => db.$transaction(async (tx) => {
    const projectEvent = new ProjectEvent(buildEventRegistry(new FlakyCalls(tx), new PrismaStockMovementFactRepository(tx)), new PrismaProcessedEventStore(tx));
    return work({ clear: async () => undefined, project: (event) => projectEvent.execute(event) });
  }),
};
const build = () => ({ subscriber: new AnalyticsEventSubscriber(flakyTransaction) });
const live = () => new AnalyticsEventSubscriber(new PrismaProjectionTransaction(db));
/** Como el poller: reintenta lo rechazado en rondas hasta que todo se aplica. */
async function deliver(subscriber: AnalyticsEventSubscriber, pending: object[]) {
  for (let round = 0; pending.length && round < 5; round++) {
    for (const e of [...pending]) {
      try {
        await subscriber.handle(e);
        pending.splice(pending.indexOf(e), 1);
      } catch { /* reintentable */ }
    }
  }
  expect(pending).toEqual([]);
}
const row = () => db.serviceCallFact.findMany();

describe('proyección de llamados en PostgreSQL', () => {
  it('las 6 permutaciones de created/acknowledged/completed dejan la misma fila', async () => {
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const evs = events();
    const results = new Set<string>();
    for (const p of perms) {
      await resetAnalytics(db);
      await deliver(build().subscriber, p.map((i) => evs[i]!));
      const rows = await row();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ pressCount: 3 });
      results.add(JSON.stringify(rows));
    }
    expect(results.size).toBe(1);
  });

  it('un error transitorio del adaptador se reintenta sin duplicar fila ni procesados', async () => {
    const { subscriber } = build();
    const [created, ...rest] = events();
    failures = 1;
    await expect(subscriber.handle(created)).rejects.toThrow('conexión perdida');
    expect(await db.processedEvent.count()).toBe(0);
    expect(await db.serviceCallFact.count()).toBe(0); // el fact aplicado se revirtió con el reclamo
    await deliver(subscriber, [created!, ...rest]);
    await subscriber.handle(created); // reentrega con el mismo event_id
    expect(await db.serviceCallFact.count()).toBe(1);
    expect(await db.processedEvent.count()).toBe(3);
  });

  it('el mismo evento entregado dos veces en paralelo se cuenta una sola vez', async () => {
    const [created] = events();
    const results = await Promise.all([live().project(created), live().project(created)]);
    expect(results.sort()).toEqual(['applied', 'duplicate']);
    expect(await db.serviceCallFact.count()).toBe(1);
    expect(await db.processedEvent.count()).toBe(1);
  });
});
