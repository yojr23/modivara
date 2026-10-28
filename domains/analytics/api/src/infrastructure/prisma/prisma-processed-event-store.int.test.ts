import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { analyticsPrismaForTests, resetAnalytics } from '../../testing/integration.js';
import { PrismaProcessedEventStore } from './prisma-processed-event-store.js';

const db = analyticsPrismaForTests();
const store = new PrismaProcessedEventStore(db);
beforeEach(() => resetAnalytics(db));
afterAll(() => db.$disconnect());

describe('PrismaProcessedEventStore', () => {
  it('has/add; el mismo event_id dos veces deja una sola fila', async () => {
    const id = newId();
    expect(await store.has(id)).toBe(false);
    await store.add(id, 'a.b.v1');
    await store.add(id, 'a.b.v1');
    expect(await store.has(id)).toBe(true);
    expect(await db.processedEvent.count()).toBe(1);
  });

  it('clear vacía la tabla', async () => {
    await store.add(newId(), 'a');
    await store.clear();
    expect(await db.processedEvent.count()).toBe(0);
  });
});
