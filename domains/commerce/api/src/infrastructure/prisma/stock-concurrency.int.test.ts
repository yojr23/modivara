import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { InsufficientStockError, InvalidMovementError } from '../../domain/errors.js';
import { commercePrismaForTests, integrationWorld, resetCommerce } from '../../testing/integration.js';

// F4-05: PostgreSQL real, sin dobles. Cada escenario se repite REPEATS veces con un producto nuevo (saldo propio) para cazar carreras raras.
const REPEATS = 20;
const db = commercePrismaForTests();
const w = integrationWorld(db);
let basics: Awaited<ReturnType<typeof w.seedBasics>>;
let reasons: { in: string; out: string; adjust: string };

beforeEach(async () => {
  await resetCommerce(db);
  basics = await w.seedBasics('base');
  reasons = { in: await basics.reason('Compra'), out: await basics.reason('Venta'), adjust: await basics.reason('Corrección de conteo') };
});
afterAll(() => db.$disconnect());

let n = 0;
/** Un producto nuevo con `initial` en existencia (entrada inicial por el camino real). */
async function product(initial?: string) {
  const p = await w.createProduct.execute({ ...w.actor, name: `Producto ${++n}`, unit: 'bottle' });
  const target = { ...w.actor, stockLocationId: basics.stockLocation.id, productId: p.id };
  const move = (direction: 'in' | 'out' | 'adjust', quantity: string, idempotencyKey = newId()) =>
    w.registerMovement.execute({ ...target, direction, quantity, reasonId: reasons[direction], idempotencyKey });
  const count = (countedQuantity: string) =>
    w.adjustToCount.execute({ ...target, countedQuantity, reasonId: reasons.adjust, idempotencyKey: newId() });
  if (initial) await move('in', initial);
  const ledger = async () => {
    const [balanceRow] = await db.stockBalance.findMany({ where: { productId: p.id } });
    const movements = await db.stockMovement.findMany({ where: { productId: p.id } });
    const events = await db.outboxEvent.findMany({ where: { aggregateId: { in: movements.map((m) => m.id) } } });
    return { balance: balanceRow?.quantity.toFixed(3), movements, events };
  };
  return { id: p.id, move, count, ledger };
}

const settle = async <T>(jobs: Array<Promise<T>>) => {
  const settled = await Promise.allSettled(jobs);
  const ok: T[] = [];
  const failed: unknown[] = [];
  for (const s of settled) (s.status === 'fulfilled' ? ok.push(s.value as T) : failed.push(s.reason));
  return { ok, failed };
};

type Ledger = Awaited<ReturnType<Awaited<ReturnType<typeof product>>['ledger']>>;
const sumDeltas = (l: Ledger) => l.movements.reduce((acc, m) => acc + Math.round(Number(m.delta) * 1000), 0) / 1000;

/** Invariantes de cualquier historial: suma de deltas == saldo, nunca negativo, 1 evento por movimiento y los balance_after forman una cadena sin huecos. */
function expectConsistent(l: Ledger) {
  expect(sumDeltas(l)).toBe(Number(l.balance ?? 0));
  expect(l.events).toHaveLength(l.movements.length);
  const q = (v: { toFixed(n: number): string }) => v.toFixed(3);
  for (const m of l.movements) expect(Number(m.balanceAfter)).toBeGreaterThanOrEqual(0);
  // Cadena sin depender del orden: {saldos previos} + {final} == {saldos posteriores} + {inicial 0}.
  const before = l.movements.map((m) => (Number(m.balanceAfter) - Number(m.delta)).toFixed(3)).concat(l.balance ?? '0.000').sort();
  const after = l.movements.map((m) => q(m.balanceAfter)).concat('0.000').sort();
  expect(before).toEqual(after);
}

describe(`F4-05 saldos concurrentes (x${REPEATS})`, () => {
  it('saldo 10 y 20 salidas de 1 en paralelo: exactamente 10 aceptadas, saldo 0, 10 rechazadas', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const p = await product('10');
      const { ok, failed } = await settle(Array.from({ length: 20 }, () => p.move('out', '1')));
      expect(ok).toHaveLength(10);
      expect(failed).toHaveLength(10);
      for (const e of failed) expect(e).toBeInstanceOf(InsufficientStockError);
      const l = await p.ledger();
      expect(l.balance).toBe('0.000');
      expect(l.movements).toHaveLength(11); // la entrada inicial + 10 salidas
      expect(l.movements.filter((m) => m.direction === 'out')).toHaveLength(10);
      expect(l.events.filter((e) => e.eventType === 'commerce.stock.issued')).toHaveLength(10);
      expectConsistent(l);
    }
  });

  it('la misma Idempotency-Key 10 veces en paralelo: 1 movimiento, 1 evento, saldo aplicado una vez', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const p = await product('10');
      const key = newId();
      const { ok, failed } = await settle(Array.from({ length: 10 }, () => p.move('out', '4', key)));
      expect(failed).toEqual([]);
      expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
      expect(new Set(ok.map((r) => r.movement.id)).size).toBe(1);
      const l = await p.ledger();
      expect(l.balance).toBe('6.000');
      expect(l.movements.filter((m) => m.idempotencyKey === key)).toHaveLength(1);
      expectConsistent(l);
    }
  });

  it('entradas y salidas cruzadas: todas aceptadas, saldo exacto y cadena de saldos íntegra', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const p = await product('10'); // 10 salidas de 1 nunca exceden el saldo, sea cual sea el orden
      const jobs = Array.from({ length: 10 }, () => [p.move('in', '2'), p.move('out', '1')]).flat();
      const { ok, failed } = await settle(jobs);
      expect(failed).toEqual([]);
      expect(ok).toHaveLength(20);
      const l = await p.ledger();
      expect(l.balance).toBe('20.000'); // 10 + 10×2 − 10×1
      expectConsistent(l);
    }
  });

  it('doble ajuste por conteo al mismo valor: uno se aplica y el otro se rechaza (conteo igual al saldo)', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const p = await product('10');
      const { ok, failed } = await settle([p.count('7'), p.count('7')]);
      expect(ok).toHaveLength(1);
      expect(ok[0]!.movement.delta.toString()).toBe('-3.000');
      expect(failed).toHaveLength(1);
      expect(failed[0]).toBeInstanceOf(InvalidMovementError);
      const l = await p.ledger();
      expect(l.balance).toBe('7.000');
      expect(l.movements.filter((m) => m.direction === 'adjust')).toHaveLength(1);
      expectConsistent(l);
    }
  });

  it('doble ajuste por conteo a valores distintos: ambos se aplican en serie y el saldo final es el del último', async () => {
    for (let i = 0; i < REPEATS; i++) {
      const p = await product('10');
      const { ok, failed } = await settle([p.count('7'), p.count('4')]);
      expect(failed).toEqual([]);
      expect(ok).toHaveLength(2);
      const l = await p.ledger();
      expect(['4.000', '7.000']).toContain(l.balance);
      // El delta de cada conteo se calculó contra el saldo bloqueado, nunca contra una lectura vieja.
      const deltas = ok.map((r) => r.movement.delta.toString()).sort();
      expect(deltas).toEqual(l.balance === '4.000' ? ['-3.000', '-3.000'] : ['-6.000', '3.000']);
      expectConsistent(l);
    }
  });

  it('productos distintos no se bloquean entre sí y no se mezclan los saldos', async () => {
    const [a, b] = [await product('10'), await product('10')];
    const { ok, failed } = await settle([...Array.from({ length: 10 }, () => a.move('out', '1')), ...Array.from({ length: 10 }, () => b.move('out', '1'))]);
    expect(failed).toEqual([]);
    expect(ok).toHaveLength(20);
    expect((await a.ledger()).balance).toBe('0.000');
    expect((await b.ledger()).balance).toBe('0.000');
  });
});
