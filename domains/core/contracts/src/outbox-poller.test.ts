import { describe, expect, it } from 'vitest';
import { OutboxPoller, type OutboxDb } from './outbox-poller.js';
import type { IntegrationEventSubscriber } from './integration.js';

/** BD falsa: un único evento pendiente; `FOR UPDATE SKIP LOCKED` se modela con `locked` (fila retenida mientras dura la transacción). */
function fakeDb() {
  const state = { locked: false, dispatched: false, attempts: 0, nextAttemptAt: 0, lockedMs: 0 };
  const row = { id: 'e1', event_type: 't', event_version: 1, occurred_at: new Date(), organization_id: 'o', location_id: 'l', aggregate_id: 'a', correlation_id: 'c', causation_id: null, payload: {}, attempts: 0 };
  const db: OutboxDb = {
    $queryRaw: (async () => [] as unknown[]) as OutboxDb['$queryRaw'],
    $executeRaw: (async () => 0) as OutboxDb['$executeRaw'],
    $transaction: async (fn) => {
      if (state.locked || state.dispatched || Date.now() < state.nextAttemptAt) return fn({ $queryRaw: (async () => []) as never, $executeRaw: (async () => 0) as never });
      state.locked = true;
      const t0 = Date.now();
      try {
        return await fn({
          $queryRaw: (async () => [{ ...row, attempts: state.attempts }]) as never,
          $executeRaw: (async (_s: TemplateStringsArray, ...v: unknown[]) => {
            if (v.length === 1) state.dispatched = true;
            else { state.attempts = v[0] as number; state.nextAttemptAt = Date.now() + 1000 * (v[2] as number); }
            return 1;
          }) as never,
        });
      } finally {
        state.locked = false;
        state.lockedMs = Date.now() - t0;
      }
    },
  };
  return { db, state };
}

const quiet = { warn: () => undefined, error: () => undefined };

describe('OutboxPoller con suscriptor colgado (ARC-08)', () => {
  it('el timeout libera la fila y el lote, y aborta la señal del suscriptor', async () => {
    const { db, state } = fakeDb();
    let aborted = false;
    const hung: IntegrationEventSubscriber = {
      name: 'colgado', handles: () => true,
      handle: (_e, signal) => new Promise(() => { signal?.addEventListener('abort', () => (aborted = true)); }),
    };
    const poller = new OutboxPoller(db, [hung], { deliveryTimeoutMs: 40, baseBackoffMs: 10_000 }, quiet);
    const t0 = Date.now();
    expect(await poller.tick()).toBe(1);
    // El lote no queda bloqueado más allá del timeout y la fila se libera al terminar la transacción.
    expect(Date.now() - t0).toBeLessThan(500);
    expect(state.locked).toBe(false);
    expect(state.lockedMs).toBeGreaterThanOrEqual(35);
    expect(state.attempts).toBe(1);
    expect(aborted).toBe(true);
  });

  it('un suscriptor que ignora la señal sigue corriendo y se solapa con el reintento (riesgo residual documentado)', async () => {
    const { db, state } = fakeDb();
    let running = 0;
    let maxConcurrent = 0;
    const ignoresSignal: IntegrationEventSubscriber = {
      name: 'terco', handles: () => true,
      handle: async () => {
        maxConcurrent = Math.max(maxConcurrent, ++running);
        await new Promise((r) => setTimeout(r, 400)); // más lento que timeout + backoff
        running--;
      },
    };
    const poller = new OutboxPoller(db, [ignoresSignal], { deliveryTimeoutMs: 30, baseBackoffMs: 1 }, quiet);
    await poller.tick();
    await new Promise((r) => setTimeout(r, 100)); // vence el backoff (1 ms) con la primera ejecución aún en curso
    await poller.tick();
    // Conclusión: la entrega se reintenta mientras la primera sigue en curso; la fila nunca queda retenida (state.locked) pero
    // el suscriptor ve dos ejecuciones simultáneas del mismo event_id, por eso debe ser idempotente.
    expect(maxConcurrent).toBe(2);
    expect(state.locked).toBe(false);
  });
});
