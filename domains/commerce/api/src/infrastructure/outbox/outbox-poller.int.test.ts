import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stockAdjustedV1, stockIssuedV1, stockReceivedV1 } from '@modivara/commerce-contracts';
import { type IntegrationEvent, type IntegrationEventSubscriber, newId } from '@modivara/core-contracts';
import { commercePrismaForTests, integrationWorld, resetCommerce } from '../../testing/integration.js';
import { backoffMs, OutboxPoller, type OutboxPollerOptions } from './outbox-poller.js';

const db = commercePrismaForTests();
const w = integrationWorld(db);
const FAST: Partial<OutboxPollerOptions> = { baseBackoffMs: 200, maxBackoffMs: 5000, intervalMs: 20 };

beforeEach(() => resetCommerce(db));
afterAll(() => db.$disconnect());

async function movements() {
  const { stockLocation, product, reason } = await w.seedBasics();
  const move = async (direction: 'in' | 'out' | 'adjust', quantity: string, reasonName: string) =>
    (await w.registerMovement.execute({
      ...w.actor, stockLocationId: stockLocation.id, productId: product.id, direction, quantity, reasonId: await reason(reasonName), idempotencyKey: newId(),
    })).movement;
  return { move };
}

const recorder = (over: Partial<IntegrationEventSubscriber> = {}) => {
  const seen: IntegrationEvent[] = [];
  const subscriber: IntegrationEventSubscriber = { name: 'rec', handles: () => true, handle: async (e) => void seen.push(e), ...over };
  return { seen, subscriber };
};

describe('OutboxPoller de commerce', () => {
  it('cada movimiento produce 1 evento del tipo correcto que valida con el esquema Zod de commerce-contracts', async () => {
    const { move } = await movements();
    const received = await move('in', '10', 'Compra');
    const issued = await move('out', '3', 'Venta');
    const adjusted = await move('adjust', '-2', 'Corrección de conteo');
    const { seen, subscriber } = recorder();
    await new OutboxPoller(db, [subscriber], FAST).tick();

    expect(seen).toHaveLength(3);
    const byAggregate = new Map(seen.map((e) => [e.aggregate_id, e]));
    const cases = [
      [received, 'commerce.stock.received', stockReceivedV1, '10.000'],
      [issued, 'commerce.stock.issued', stockIssuedV1, '7.000'],
      [adjusted, 'commerce.stock.adjusted', stockAdjustedV1, '5.000'],
    ] as const;
    for (const [m, type, schema, balanceAfter] of cases) {
      const event = byAggregate.get(m.id)!;
      expect(event.event_type).toBe(type);
      const parsed = schema.parse(event);
      expect(parsed.payload).toMatchObject({ movement_id: m.id, delta: m.delta.toString(), balance_after: balanceAfter, product_name: 'Cerveza' });
      expect(parsed).toMatchObject({ organization_id: w.t.organizationId, location_id: w.t.locationId });
    }
    const rows = await db.outboxEvent.findMany();
    expect(rows.every((r) => r.dispatchedAt && r.attempts === 1)).toBe(true);
    await new OutboxPoller(db, [subscriber], FAST).tick();
    expect(seen).toHaveLength(3); // ya despachados: no se repiten
  });

  it('una salida rechazada no publica nada', async () => {
    const { move } = await movements();
    await expect(move('out', '1', 'Venta')).rejects.toThrow();
    const { seen, subscriber } = recorder();
    expect(await new OutboxPoller(db, [subscriber], FAST).tick()).toBe(0);
    expect(seen).toEqual([]);
  });

  it('suscriptor que falla: reintento con espera creciente y luego se despacha', async () => {
    const { move } = await movements();
    await move('in', '1', 'Compra');
    const handle = vi.fn<(e: IntegrationEvent) => Promise<void>>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const poller = new OutboxPoller(db, [{ name: 'flaky', handles: () => true, handle }], FAST);
    await poller.tick();
    const [failed] = await db.outboxEvent.findMany();
    expect(failed).toMatchObject({ attempts: 1, lastError: 'boom', dispatchedAt: null });
    await poller.tick();
    expect(handle).toHaveBeenCalledTimes(1); // aún no vence
    await new Promise((r) => setTimeout(r, 250));
    await poller.tick();
    expect(handle).toHaveBeenCalledTimes(2);
    expect((await db.outboxEvent.findMany())[0]!.dispatchedAt).not.toBeNull();
  });

  it('dos pollers en paralelo no duplican la entrega (SKIP LOCKED) y sin suscriptores igual se despacha', async () => {
    const { move } = await movements();
    for (let i = 0; i < 8; i++) await move('in', '1', 'Compra');
    const deliveries = new Map<string, number>();
    const slow: IntegrationEventSubscriber = {
      name: 'slow', handles: () => true,
      handle: async (e) => { await new Promise((r) => setTimeout(r, 15)); deliveries.set(e.event_id, (deliveries.get(e.event_id) ?? 0) + 1); },
    };
    const [a, b] = await Promise.all([new OutboxPoller(db, [slow], FAST).tick(), new OutboxPoller(db, [slow], FAST).tick()]);
    expect(a + b).toBe(8);
    expect([...deliveries.values()].every((n) => n === 1)).toBe(true);
    await move('in', '1', 'Compra');
    await new OutboxPoller(db, [], FAST).tick();
    expect(await db.outboxEvent.count({ where: { dispatchedAt: null } })).toBe(0);
  });

  it('espera creciente con tope', () => {
    const o = { baseBackoffMs: 1000, maxBackoffMs: 5000 };
    expect([1, 2, 3, 4, 20].map((n) => backoffMs(n, o))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
});
