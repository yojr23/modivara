import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { StockMovementFact } from '../../domain/index.js';
import { analyticsPrismaForTests, resetAnalytics, tenant } from '../../testing/integration.js';
import { PrismaStockMovementFactRepository } from './prisma-stock-movement-fact-repository.js';

const db = analyticsPrismaForTests();
const repo = new PrismaStockMovementFactRepository(db);
const t = tenant();
const place = newId();
const product = newId();
beforeEach(() => resetAnalytics(db));
afterAll(() => db.$disconnect());

const fact = (occurredAt: string, balanceAfter: string, x: { id?: string; place?: string; product?: string; loc?: typeof t } = {}) =>
  StockMovementFact.create({
    ...(x.loc ?? t), direction: 'in',
    payload: {
      movement_id: x.id ?? newId(), stock_location_id: x.place ?? place, product_id: x.product ?? product, product_name: 'Cerveza',
      reason_id: newId(), reason_name: 'Compra', delta: '1.5', balance_after: balanceAfter, occurred_at: occurredAt, actor_user_id: newId(),
    },
  });
const ids = (fs: StockMovementFact[]) => fs.map((f) => f.movementId).sort();

describe('PrismaStockMovementFactRepository', () => {
  it('save inserta y reemplaza por id; decimales exactos con 3 decimales', async () => {
    const f = fact('2026-10-01T10:00:00.000Z', '10');
    await repo.save(f);
    await repo.save(f);
    expect(await db.stockMovementFact.count()).toBe(1);
    const [got] = await repo.findOccurredBetween({ ...t, range: { from: new Date('2026-10-01'), to: new Date('2026-10-02') } });
    expect(got?.snapshot).toEqual(f.snapshot);
    expect(got?.snapshot).toMatchObject({ delta: '1.500', balanceAfter: '10.000' });
  });

  it('findOccurredBetween filtra por local, rango, producto y lugar', async () => {
    const otherProduct = newId();
    const otherPlace = newId();
    const a = fact('2026-10-01T10:00:00.000Z', '1');
    const b = fact('2026-10-01T11:00:00.000Z', '2', { product: otherProduct });
    const c = fact('2026-10-01T12:00:00.000Z', '3', { place: otherPlace });
    const outside = fact('2026-10-02T00:00:00.000Z', '4');
    const foreign = fact('2026-10-01T10:00:00.000Z', '5', { loc: tenant() });
    for (const f of [a, b, c, outside, foreign]) await repo.save(f);
    const q = { ...t, range: { from: new Date('2026-10-01T00:00:00.000Z'), to: new Date('2026-10-02T00:00:00.000Z') } };
    expect(ids(await repo.findOccurredBetween(q))).toEqual(ids([a, b, c]));
    expect(ids(await repo.findOccurredBetween({ ...q, productId: otherProduct }))).toEqual([b.movementId]);
    expect(ids(await repo.findOccurredBetween({ ...q, stockLocationId: otherPlace }))).toEqual([c.movementId]);
  });

  it('findLatestPerPlaceAndProduct: último por occurred_at, desempate por movement_id mayor, sin límite de fecha, con filtros', async () => {
    const otherProduct = newId();
    const old = fact('2026-01-01T10:00:00.000Z', '1');
    const latest = fact('2026-10-01T10:00:00.000Z', '2');
    const tieLow = fact('2026-10-05T10:00:00.000Z', '3', { id: '00000000-0000-7000-8000-000000000001', product: otherProduct });
    const tieHigh = fact('2026-10-05T10:00:00.000Z', '4', { id: '00000000-0000-7000-8000-000000000002', product: otherProduct });
    const foreign = fact('2026-10-09T10:00:00.000Z', '9', { loc: tenant() });
    for (const f of [old, latest, tieLow, tieHigh, foreign]) await repo.save(f);
    const got = await repo.findLatestPerPlaceAndProduct(t);
    expect(ids(got)).toEqual(ids([latest, tieHigh]));
    expect(got.find((f) => f.movementId === latest.movementId)?.snapshot.balanceAfter).toBe('2.000');
    expect(ids(await repo.findLatestPerPlaceAndProduct({ ...t, productId: product }))).toEqual([latest.movementId]);
    expect(await repo.findLatestPerPlaceAndProduct({ ...t, stockLocationId: newId() })).toEqual([]);
  });

  it('clear vacía la tabla', async () => {
    await repo.save(fact('2026-10-01T10:00:00.000Z', '1'));
    await repo.clear();
    expect(await db.stockMovementFact.count()).toBe(0);
  });
});
