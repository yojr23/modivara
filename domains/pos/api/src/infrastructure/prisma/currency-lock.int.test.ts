import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { CurrencyLockedError, CurrencyMismatchError } from '../../domain/errors.js';
import { UpdatePosSettings } from '../../application/use-cases.js';
import { integrationWorld, posPrismaForTests, resetPos } from '../../testing/integration.js';
import type { PosPrisma } from './client.js';
import { lockCurrency } from './db.js';
import type { Prisma } from './generated/client.js';
import { PrismaPosSettingsRepository } from './prisma-pos-settings-repository.js';

// Carrera cambio de moneda vs alta de venta/artículo con barreras reales en PostgreSQL: uno gana, el otro falla, y nunca queda
// una venta abierta ni un artículo activo en moneda distinta a la del local.
const db = posPrismaForTests();
beforeEach(() => resetPos(db));
afterAll(() => db.$disconnect());

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

/** Espera a que alguna sesión esté bloqueada esperando un candado advisory (la barrera real, no un sleep a ciegas). */
async function waitBlocked() {
  for (let i = 0; i < 100; i++) {
    const [r] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
    if (r!.n > 0n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('nadie quedó esperando el candado');
}

async function stillPending(p: Promise<unknown>) {
  const marker = Symbol();
  return (await Promise.race([p.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r(marker), 200))])) === marker;
}

/**
 * `UpdatePosSettings` que se detiene con el candado exclusivo ya tomado, antes de leer la moneda vigente: el cliente que ve el
 * repositorio es una envoltura de `client` cuya transacción espera en `release` justo en esa primera lectura.
 */
function pausedUpdate(w: ReturnType<typeof integrationWorld>, client: PosPrisma = db) {
  const entered = deferred();
  const release = deferred();
  const paused = {
    locationSettings: client.locationSettings,
    $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, opts: object) => client.$transaction((tx) => fn(new Proxy(tx, {
      get(t, k) {
        if (k === 'locationSettings') {
          return { upsert: (a: never) => t.locationSettings.upsert(a), findUnique: async (a: never) => { entered.resolve(); await release.promise; return t.locationSettings.findUnique(a); } };
        }
        const v = Reflect.get(t, k, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    })), opts),
  } as unknown as PosPrisma;
  return { entered, release, update: new UpdatePosSettings(new PrismaPosSettingsRepository(paused), w.core) };
}

const addItem = (w: ReturnType<typeof integrationWorld>) => w.createItem.execute({ ...w.actor, name: `A ${newId()}`, unit: 'unit', price: '1' });
const openSale = (w: ReturnType<typeof integrationWorld>) => w.openSale.execute({ ...w.actor, idempotencyKey: newId() });

describe.each([
  ['venta', openSale, () => db.sale.findMany({ where: { status: 'open' } })],
  ['artículo', addItem, () => db.sellableItem.findMany({ where: { deactivatedAt: null } })],
] as const)('cambio de moneda vs alta de %s', (_name, create, rows) => {
  it('el cambio toma el candado primero: el alta espera y luego falla con currency_mismatch', async () => {
    const w = integrationWorld(db);
    const { entered, release, update } = pausedUpdate(w);
    const changing = update.execute({ ...w.actor, currency: 'USD' });
    await entered.promise;
    const creating = create(w);
    const outcome = creating.then(() => null, (e: unknown) => e);
    await waitBlocked();
    expect(await stillPending(creating)).toBe(true); // no se coló antes del cambio
    release.resolve();
    expect(await changing).toEqual({ currency: 'USD' });
    expect(await outcome).toBeInstanceOf(CurrencyMismatchError);
    expect(await rows()).toHaveLength(0);
  });

  it('el alta toma el candado primero: el cambio espera y luego falla con currency_locked', async () => {
    const w = integrationWorld(db);
    const held = deferred();
    const released = deferred();
    // Una sesión retiene el candado compartido (como un alta a medio hacer) mientras el alta real se confirma.
    const holder = db.$transaction(async (tx) => { await lockCurrency(tx, w.t.locationId, 'shared'); held.resolve(); await released.promise; });
    await held.promise;
    await create(w); // confirmada en COP
    const changing = w.updateSettings.execute({ ...w.actor, currency: 'USD' });
    const outcome = changing.then(() => null, (e: unknown) => e);
    await waitBlocked();
    expect(await stillPending(changing)).toBe(true);
    released.resolve();
    await holder;
    expect(await outcome).toBeInstanceOf(CurrencyLockedError);
    expect(await w.settings.findCurrency(w.t)).toBeNull(); // sigue en la moneda por defecto
    const left = await rows();
    expect(left).toHaveLength(1);
    expect(left[0]!.currency).toBe('COP');
  });
});

it('una carrera repetida sin barreras nunca deja una venta abierta ni un artículo activo en otra moneda', async () => {
  for (let i = 0; i < 10; i++) {
    const w = integrationWorld(db);
    await Promise.allSettled([w.updateSettings.execute({ ...w.actor, currency: 'USD' }), openSale(w), addItem(w)]);
    const currency = (await w.settings.findCurrency(w.t)) ?? 'COP';
    expect((await db.sale.findMany({ where: { locationId: w.t.locationId, status: 'open' } })).every((s) => s.currency === currency)).toBe(true);
    expect((await db.sellableItem.findMany({ where: { locationId: w.t.locationId, deactivatedAt: null } })).every((s) => s.currency === currency)).toBe(true);
  }
});

it('con el pool agotado por altas esperando el candado compartido, el cambio de moneda igual termina (misma conexión)', async () => {
  const small = posPrismaForTests({ max: 2 });
  try {
    const w = integrationWorld(small);
    const { entered, release, update } = pausedUpdate(w, small);
    const changing = update.execute({ ...w.actor, currency: 'USD' });
    await entered.promise; // el cambio ya tiene el candado exclusivo y 1 de las 2 conexiones
    const outcomes = [addItem(w), openSale(w), addItem(w), openSale(w)].map((p) => p.then(() => null, (e: unknown) => e));
    await waitBlocked(); // las altas ocupan el resto del pool esperando el candado compartido
    release.resolve();
    expect(await changing).toEqual({ currency: 'USD' }); // antes: espera de pool de 15 s
    for (const o of await Promise.all(outcomes)) expect(o).toBeInstanceOf(CurrencyMismatchError);
    expect(await db.sale.count({ where: { locationId: w.t.locationId, status: 'open' } })).toBe(0);
    expect(await db.sellableItem.count({ where: { locationId: w.t.locationId, deactivatedAt: null } })).toBe(0);
    expect(await w.settings.findCurrency(w.t)).toBe('USD');
  } finally {
    await small.$disconnect();
  }
}, 10_000);
