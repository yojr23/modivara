import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, type CoreAccessPort, type LocationRef } from '@modivara/core-contracts';
import { inventoryMetricsSchema, serviceCallMetricsSchema } from '@modivara/analytics-contracts';
import { analyticsPrismaForTests, resetAnalytics, tenant } from '../testing/integration.js';
import { PrismaServiceCallFactRepository, PrismaStockMovementFactRepository } from '../infrastructure/prisma/index.js';
import { GetInventoryMetrics, GetServiceCallMetrics } from './index.js';

// F5-05/F5-06 contra PostgreSQL real, pasando por los casos de uso. Rango `custom` fijo: no depende del reloj.
const db = analyticsPrismaForTests();
const t = tenant();
const location: LocationRef = { id: t.locationId, organizationId: t.organizationId, timezone: 'America/Bogota', active: true };
const core = { getLocation: async (id: string) => (id === location.id ? { ...location } : null) } as unknown as CoreAccessPort;
const calls = new GetServiceCallMetrics(new PrismaServiceCallFactRepository(db), core);
const stock = new GetInventoryMetrics(new PrismaStockMovementFactRepository(db), core);
const input = { organizationId: t.organizationId, locationId: t.locationId };
const day = { range: 'custom' as const, from: '2026-10-19', to: '2026-10-19' };

beforeEach(async () => {
  location.timezone = 'America/Bogota';
  await resetAnalytics(db);
});
afterAll(() => db.$disconnect());

const call = (created: string, ackS: number | null, doneS: number | null, pressCount: number, over: { zone?: [string, string]; locationId?: string } = {}) => {
  const at = (s: number | null) => (s === null ? null : new Date(new Date(created).getTime() + s * 1000));
  return db.serviceCallFact.create({
    data: {
      serviceCallId: newId(), organizationId: t.organizationId, locationId: over.locationId ?? t.locationId, tableId: newId(), tableLabel: 'M1',
      zoneId: over.zone?.[0] ?? null, zoneName: over.zone?.[1] ?? null, callType: 'attention', createdAt: new Date(created),
      acknowledgedAt: at(ackS), completedAt: at(doneS), pressCount,
    },
  });
};

describe('métricas de llamados en PostgreSQL', () => {
  const seed = async () => {
    await call('2026-10-19T14:00:00Z', 60, 180, 1); // 09:00 Bogotá
    await call('2026-10-19T14:30:00Z', 120, 300, 3); // 09:30 Bogotá
    await call('2026-10-20T02:30:00Z', null, null, 1); // 21:30 del 19 en Bogotá; ya es el 20 en Tokio
    await call('2026-10-18T04:59:00Z', 10, 20, 1); // fuera: 23:59 del 17 en Bogotá
    await call('2026-10-19T14:00:00Z', 10, 20, 1, { locationId: newId() }); // otro local
  };

  it('totales, promedios y medianas coinciden con el cálculo manual', async () => {
    await seed();
    const m = serviceCallMetricsSchema.parse(await calls.execute({ ...input, query: { ...day, group_by: 'day' } }));
    expect(m.totals).toEqual({ calls: 3, pending: 1, in_progress: 0, completed: 2, repeated_presses: 2, calls_with_repeated_presses: 1 });
    // reconocer: 60 s y 120 s => promedio 90, mediana 90. cerrar: 180 s y 300 s => promedio 240, mediana 240.
    expect(m.time_to_acknowledge).toEqual({ count: 2, average_seconds: 90, median_seconds: 90 });
    expect(m.time_to_complete).toEqual({ count: 2, average_seconds: 240, median_seconds: 240 });
    expect(m.from).toBe('2026-10-19T05:00:00.000Z');
    expect(m.to).toBe('2026-10-20T05:00:00.000Z');
    expect(m.by_period.map((p) => p.calls)).toEqual([3]);
  });

  it('la mediana de una cantidad impar es el valor central', async () => {
    for (const s of [30, 90, 600]) await call('2026-10-19T14:00:00Z', s, null, 1);
    const m = await calls.execute({ ...input, query: { ...day, group_by: 'day' } });
    expect(m.time_to_acknowledge).toEqual({ count: 3, average_seconds: 240, median_seconds: 90 });
  });

  it('cambiar la zona horaria del local mueve el llamado de hora y de día', async () => {
    await seed();
    const bogota = (await calls.execute({ ...input, query: { ...day, group_by: 'hour' } })).by_period;
    expect(bogota.map((p) => [p.bucket_start, p.calls])).toEqual([['2026-10-19T14:00:00.000Z', 2], ['2026-10-20T02:00:00.000Z', 1]]);
    expect(bogota[0]!.bucket_label).toBe('2026-10-19T09:00'); // 14:00Z = 09:00 en Bogotá

    location.timezone = 'Asia/Tokyo'; // 19 oct local = 18 15:00Z .. 19 15:00Z: el tercer llamado ya cae el 20
    const tokyo = await calls.execute({ ...input, query: { ...day, group_by: 'hour' } });
    expect(tokyo.from).toBe('2026-10-18T15:00:00.000Z');
    expect(tokyo.totals.calls).toBe(2);
    expect(tokyo.by_period.map((p) => [p.bucket_start, p.calls])).toEqual([['2026-10-19T14:00:00.000Z', 2]]);
    expect(tokyo.by_period[0]!.bucket_label).toBe('2026-10-19T23:00'); // 14:00Z = 23:00 en Tokio

    const nextDay = await calls.execute({ ...input, query: { range: 'custom', from: '2026-10-20', to: '2026-10-20', group_by: 'day' } });
    expect(nextDay.totals.calls).toBe(1); // en Tokio el llamado de las 02:30Z es del 20
  });

  it('agrupa por zona y filtra por zona', async () => {
    const [z1, z2] = [newId(), newId()];
    await call('2026-10-19T14:00:00Z', null, null, 1, { zone: [z1, 'Terraza'] });
    await call('2026-10-19T15:00:00Z', null, null, 1, { zone: [z1, 'Terraza'] });
    await call('2026-10-19T16:00:00Z', null, null, 1, { zone: [z2, 'Salón'] });
    const all = await calls.execute({ ...input, query: { ...day, group_by: 'day' } });
    expect(Object.fromEntries(all.by_zone.map((z) => [z.zone_name, z.calls]))).toEqual({ Terraza: 2, Salón: 1 });
    const one = await calls.execute({ ...input, query: { ...day, group_by: 'day', zone_id: z2 } });
    expect(one.totals.calls).toBe(1);
  });
});

describe('métricas de inventario en PostgreSQL', () => {
  const [p1, p2, place, compra, venta, ajuste] = [newId(), newId(), newId(), newId(), newId(), newId()];
  const move = (productId: string, direction: string, reason: [string, string], delta: string, balanceAfter: string, at: string) =>
    db.stockMovementFact.create({
      data: {
        movementId: newId(), organizationId: t.organizationId, locationId: t.locationId, stockLocationId: place, productId,
        productName: productId === p1 ? 'Ron' : 'Cerveza', direction, reasonId: reason[0], reasonName: reason[1], delta, balanceAfter, occurredAt: new Date(at),
      },
    });

  it('suma por motivo y dirección los hechos sembrados; el saldo es el último conocido', async () => {
    await move(p1, 'in', [compra, 'Compra'], '10.000', '10.000', '2026-10-19T14:00:00Z');
    await move(p1, 'out', [venta, 'Venta'], '-3.000', '7.000', '2026-10-19T15:00:00Z');
    await move(p1, 'out', [venta, 'Venta'], '-2.500', '4.500', '2026-10-19T16:00:00Z');
    await move(p1, 'adjust', [ajuste, 'Conteo'], '-1.000', '3.500', '2026-10-19T17:00:00Z');
    await move(p2, 'in', [compra, 'Compra'], '5.000', '5.000', '2026-10-19T14:00:00Z');
    await move(p2, 'out', [venta, 'Venta'], '-1.000', '4.000', '2026-10-20T14:00:00Z'); // fuera del rango, pero cuenta para el saldo
    const m = inventoryMetricsSchema.parse(await stock.execute({ ...input, query: { ...day, group_by: 'day' } }));

    const reason = (id: string) => m.by_reason.find((r) => r.reason_id === id)!;
    expect(reason(compra)).toMatchObject({ direction: 'in', movement_count: 2, total_delta: '15.000' });
    expect(reason(venta)).toMatchObject({ direction: 'out', movement_count: 2, total_delta: '-5.500' });
    expect(reason(ajuste)).toMatchObject({ direction: 'adjust', movement_count: 1, total_delta: '-1.000' });
    expect(Object.fromEntries(m.by_direction.map((d) => [d.direction, d.total_delta]))).toEqual({ in: '15.000', out: '-5.500', adjust: '-1.000' });
    expect(m.by_period).toHaveLength(1);
    expect(m.by_period[0]).toMatchObject({ movement_count: 5, in_delta: '15.000', out_delta: '-5.500', adjust_delta: '-1.000' });
    expect(Object.fromEntries(m.balances.map((b) => [b.product_name, b.balance]))).toEqual({ Ron: '3.500', Cerveza: '4.000' });

    const only = await stock.execute({ ...input, query: { ...day, group_by: 'day', product_id: p2 } });
    expect(only.by_direction[0]).toEqual({ direction: 'in', movement_count: 1, total_delta: '5.000' });
    expect(only.by_period[0]).toMatchObject({ movement_count: 1 });
  });

  it('el día depende de la zona horaria del local', async () => {
    await move(p1, 'in', [compra, 'Compra'], '1.000', '1.000', '2026-10-20T02:30:00Z'); // 21:30 del 19 en Bogotá
    const count = async () => (await stock.execute({ ...input, query: { ...day, group_by: 'day' } })).by_period.length;
    expect(await count()).toBe(1);
    location.timezone = 'Asia/Tokyo';
    expect(await count()).toBe(0);
  });
});

describe('aislamiento de esquemas', () => {
  it('el rol de analytics no ve otros esquemas: las consultas solo usan analytics', async () => {
    const [row] = await db.$queryRawUnsafe<Array<{ s: string | null }>>(
      `SELECT string_agg(nspname::text, ',') AS s FROM pg_namespace WHERE nspname IN ('core','hospitality','commerce') AND has_schema_privilege(current_user, nspname, 'USAGE')`,
    );
    expect(row!.s).toBeNull();
  });
});
