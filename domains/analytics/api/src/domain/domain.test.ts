import { describe, expect, it } from 'vitest';
import { resolveRange } from './date-range.js';
import { computeInventoryMetrics, latestPerPlaceAndProduct } from './inventory-metrics.js';
import { ServiceCallFact } from './service-call-fact.js';
import { computeServiceCallMetrics, durationStats } from './service-call-metrics.js';
import { StockMovementFact } from './stock-movement-fact.js';
import { bucketOf } from './time-zone.js';
import { TenantMismatchError } from './errors.js';

const TZ = 'America/Bogota'; // UTC-5 sin DST
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = uuid(100);
const LOC = uuid(101);

describe('cubetas en zona horaria del local', () => {
  it('23:59:59 locales sigue en el día; medianoche local abre el siguiente', () => {
    expect(bucketOf(new Date('2026-10-20T04:59:59Z'), 'day', TZ)).toEqual({ start: new Date('2026-10-19T05:00:00Z'), label: '2026-10-19' });
    expect(bucketOf(new Date('2026-10-20T05:00:00Z'), 'day', TZ)).toEqual({ start: new Date('2026-10-20T05:00:00Z'), label: '2026-10-20' });
  });
  it('un instante de la tarde UTC del día siguiente aún es el día local anterior', () => {
    // 02:00Z del 20 = 21:00 del 19 en Bogotá
    expect(bucketOf(new Date('2026-10-20T02:00:00Z'), 'day', TZ).label).toBe('2026-10-19');
  });
  it('agrupa por hora local', () => {
    const b = bucketOf(new Date('2026-10-20T04:59:59Z'), 'hour', TZ);
    expect(b.label).toBe('2026-10-19T23:00');
    expect(b.start).toEqual(new Date('2026-10-20T04:00:00Z'));
    expect(bucketOf(new Date('2026-10-20T05:00:00Z'), 'hour', TZ).label).toBe('2026-10-20T00:00');
  });
  it('respeta zonas con DST (Nueva York: UTC-4 en verano, UTC-5 en invierno)', () => {
    expect(bucketOf(new Date('2026-07-01T03:59:59Z'), 'day', 'America/New_York').label).toBe('2026-06-30');
    expect(bucketOf(new Date('2026-12-01T05:00:00Z'), 'day', 'America/New_York').start).toEqual(new Date('2026-12-01T05:00:00Z'));
    expect(bucketOf(new Date('2026-07-01T04:00:00Z'), 'day', 'America/New_York').start).toEqual(new Date('2026-07-01T04:00:00Z'));
  });
});

describe('atajos de rango', () => {
  const now = new Date('2026-10-20T03:00:00Z'); // 22:00 del 19 en Bogotá (en UTC ya es 20)
  const r = (range: 'today' | 'yesterday' | 'last_7_days' | 'last_30_days') => {
    const x = resolveRange({ range }, now, TZ);
    return [x.from.toISOString(), x.to.toISOString()];
  };
  it('hoy usa el día del local, no el UTC', () => expect(r('today')).toEqual(['2026-10-19T05:00:00.000Z', '2026-10-20T05:00:00.000Z']));
  it('ayer', () => expect(r('yesterday')).toEqual(['2026-10-18T05:00:00.000Z', '2026-10-19T05:00:00.000Z']));
  it('últimos 7 días incluyen hoy', () => expect(r('last_7_days')).toEqual(['2026-10-13T05:00:00.000Z', '2026-10-20T05:00:00.000Z']));
  it('últimos 30 días incluyen hoy', () => expect(r('last_30_days')).toEqual(['2026-09-20T05:00:00.000Z', '2026-10-20T05:00:00.000Z']));
  it('custom: from y to son fechas locales inclusivas', () => {
    const x = resolveRange({ range: 'custom', from: '2026-10-01', to: '2026-10-03' }, now, TZ);
    expect([x.from.toISOString(), x.to.toISOString()]).toEqual(['2026-10-01T05:00:00.000Z', '2026-10-04T05:00:00.000Z']);
  });
});

describe('estadística de tiempos', () => {
  it('promedio y mediana (par e impar)', () => {
    expect(durationStats([10_000, 30_000, 20_000])).toEqual({ count: 3, average_seconds: 20, median_seconds: 20 });
    expect(durationStats([10_000, 20_000, 30_000, 100_000])).toEqual({ count: 4, average_seconds: 40, median_seconds: 25 });
    expect(durationStats([])).toEqual({ count: 0, average_seconds: null, median_seconds: null });
  });
  it('la mediana resiste valores extremos que mueven el promedio', () => {
    const s = durationStats([1000, 2000, 3000, 1_000_000]);
    expect(s.median_seconds).toBe(2.5);
    expect(s.average_seconds).toBeGreaterThan(200);
  });
});

describe('ServiceCallFact', () => {
  const id = uuid(1);
  const created = { service_call_id: id, table_id: uuid(2), table_label: '5', zone_id: uuid(3), zone_name: 'Terraza', call_type: 'attention' as const, created_at: '2026-10-19T15:00:00Z' };
  const ack = { service_call_id: id, acknowledged_at: '2026-10-19T15:01:00Z', acknowledged_by: uuid(9), press_count: 2 };
  const done = { service_call_id: id, completed_at: '2026-10-19T15:03:00Z', completed_by: uuid(9), press_count: 3 };
  const fresh = () => ServiceCallFact.create({ organizationId: ORG, locationId: LOC }, created);

  it('estados y tiempos', () => {
    const f = fresh();
    expect(f.status).toBe('pending');
    f.applyAcknowledged(ack);
    expect(f.status).toBe('in_progress');
    expect(f.msToAcknowledge).toBe(60_000);
    f.applyCompleted(done);
    expect(f.status).toBe('completed');
    expect(f.msToComplete).toBe(180_000);
    expect(f.snapshot.pressCount).toBe(3);
  });
  it('acknowledged y completed conmutan y son idempotentes', () => {
    const run = (steps: Array<'a' | 'c'>) => {
      const f = fresh();
      for (const s of steps) s === 'a' ? f.applyAcknowledged(ack) : f.applyCompleted(done);
      return JSON.stringify(f.snapshot);
    };
    expect(new Set([run(['a', 'c']), run(['c', 'a']), run(['a', 'a', 'c', 'c', 'a'])]).size).toBe(1);
  });
  it('nace con mesa, tipo y fecha obligatorios', () => {
    expect(fresh().snapshot).toMatchObject({ tableId: uuid(2), callType: 'attention', createdAt: new Date(created.created_at) });
  });
  it('rechaza otro negocio o local', () => {
    expect(() => fresh().assertTenant(uuid(555), LOC)).toThrow(TenantMismatchError);
    try { fresh().assertTenant(uuid(555), LOC); } catch (e) { expect((e as TenantMismatchError).code).toBe('tenant_mismatch'); }
  });
  it('create exige identidad', () => {
    expect(() => ServiceCallFact.create({ organizationId: '', locationId: LOC }, created)).toThrow();
  });
});

describe('computeServiceCallMetrics', () => {
  const now = new Date('2026-10-20T03:00:00Z'); // 22:00 del 19 en Bogotá
  const range = resolveRange({ range: 'last_7_days' }, now, TZ);
  let n = 10;
  const call = (createdAt: string, o: { table?: number; zone?: number | null; ackS?: number; doneS?: number; presses?: number } = {}) => {
    const sid = uuid(n++);
    const at = new Date(createdAt).getTime();
    const table = o.table ?? 1;
    const zone = o.zone === undefined ? 1 : o.zone;
    const f = ServiceCallFact.create({ organizationId: ORG, locationId: LOC }, {
      service_call_id: sid, table_id: uuid(200 + table), table_label: `M${table}`,
      zone_id: zone === null ? null : uuid(300 + zone), zone_name: zone === null ? null : `Z${zone}`,
      call_type: 'attention', created_at: createdAt,
    });
    if (o.ackS !== undefined) f.applyAcknowledged({ service_call_id: sid, acknowledged_at: new Date(at + o.ackS * 1000).toISOString(), acknowledged_by: uuid(9), press_count: o.presses ?? 1 });
    if (o.doneS !== undefined) f.applyCompleted({ service_call_id: sid, completed_at: new Date(at + o.doneS * 1000).toISOString(), completed_by: uuid(9), press_count: o.presses ?? 1 });
    return f;
  };
  const compute = (facts: ServiceCallFact[], groupBy: 'day' | 'hour' = 'day') => computeServiceCallMetrics(facts, { timeZone: TZ, groupBy, range, now });
  const withCalls = (m: { by_period: { bucket_label: string; calls: number }[] }) => m.by_period.filter((p) => p.calls > 0);

  it('cuenta estados, pulsaciones repetidas y tiempos', () => {
    const m = compute([
      call('2026-10-19T15:00:00Z'),
      call('2026-10-19T15:10:00Z', { ackS: 30, presses: 3 }),
      call('2026-10-19T15:20:00Z', { ackS: 60, doneS: 120, presses: 2 }),
    ]);
    expect(m.totals).toEqual({ calls: 3, pending: 1, in_progress: 1, completed: 1, repeated_presses: 3, calls_with_repeated_presses: 2 });
    expect(m.time_to_acknowledge).toEqual({ count: 2, average_seconds: 45, median_seconds: 45 });
    expect(m.time_to_complete).toEqual({ count: 1, average_seconds: 120, median_seconds: 120 });
  });
  it('agrupa por mesa, zona (incluida «sin zona») y periodo en hora local', () => {
    const m = compute([
      call('2026-10-20T04:59:59Z', { table: 1, zone: 1 }), // 23:59:59 del 19
      call('2026-10-20T05:00:00Z', { table: 1, zone: 1 }), // 00:00 del 20
      call('2026-10-20T05:10:00Z', { table: 2, zone: null }),
    ]);
    expect(m.by_table.map((t) => [t.table_label, t.calls])).toEqual([['M1', 2], ['M2', 1]]);
    expect(m.by_zone.map((z) => [z.zone_name, z.calls])).toEqual([['Z1', 2], [null, 1]]);
    expect(withCalls(m).map((p) => [p.bucket_label, p.calls])).toEqual([['2026-10-19', 1], ['2026-10-20', 2]]);
  });
  it('agrupa por hora', () => {
    const m = compute([call('2026-10-20T04:59:59Z'), call('2026-10-20T05:00:00Z')], 'hour');
    expect(withCalls(m).map((p) => p.bucket_label)).toEqual(['2026-10-19T23:00', '2026-10-20T00:00']);
  });
  it('rellena con 0 los periodos sin llamados del rango, sin pasar de la cubeta actual', () => {
    const days = compute([call('2026-10-15T15:00:00Z')]).by_period;
    expect(days.map((p) => [p.bucket_label, p.calls])).toEqual([
      ['2026-10-13', 0], ['2026-10-14', 0], ['2026-10-15', 1], ['2026-10-16', 0], ['2026-10-17', 0], ['2026-10-18', 0], ['2026-10-19', 0],
    ]);
    const hours = compute([], 'hour').by_period;
    expect(hours).toHaveLength(6 * 24 + 23); // del 13 a las 00:00 hasta la hora actual (19, 22:00), inclusive
    expect(hours.at(-1)!.bucket_label).toBe('2026-10-19T22:00');
    expect(new Set(hours.map((h) => h.bucket_label)).size).toBe(hours.length);
  });
  it('ignora duraciones negativas', () => {
    const m = compute([call('2026-10-19T15:00:00Z', { ackS: -5 })]);
    expect(m.totals.calls).toBe(1);
    expect(m.time_to_acknowledge.count).toBe(0);
  });
});

describe('inventario', () => {
  const range = resolveRange({ range: 'last_7_days' }, new Date('2026-10-20T03:00:00Z'), TZ);
  let n = 1000;
  const mov = (direction: 'in' | 'out' | 'adjust', delta: string, balance: string, at: string, o: { product?: number; place?: number; reason?: [number, string] } = {}) =>
    StockMovementFact.create({
      organizationId: ORG, locationId: LOC, direction,
      payload: {
        movement_id: uuid(n++), stock_location_id: uuid(400 + (o.place ?? 1)), product_id: uuid(500 + (o.product ?? 1)), product_name: `P${o.product ?? 1}`,
        reason_id: uuid(600 + (o.reason?.[0] ?? 1)), reason_name: o.reason?.[1] ?? 'Compra', delta, balance_after: balance, occurred_at: at, actor_user_id: uuid(9),
      },
    });

  it('saldo actual = último balance_after por (lugar, producto)', () => {
    const facts = [
      mov('in', '10', '10', '2026-10-19T10:00:00Z'),
      mov('out', '-3', '7', '2026-10-19T12:00:00Z'),
      mov('in', '5', '5', '2026-10-19T11:00:00Z', { place: 2 }),
      mov('adjust', '-1', '4', '2026-10-19T11:30:00Z', { place: 2 }),
    ];
    const latest = latestPerPlaceAndProduct(facts);
    const m = computeInventoryMetrics(facts, latest, { timeZone: TZ, groupBy: 'day', range });
    expect(m.balances.map((b) => [b.stock_location_id.slice(-3), b.balance])).toEqual([['401', '7.000'], ['402', '4.000']]);
  });
  it('totales por dirección y motivo, exactos', () => {
    const facts = [
      mov('in', '0.1', '0.1', '2026-10-19T10:00:00Z'),
      mov('in', '0.2', '0.3', '2026-10-19T10:05:00Z'),
      mov('out', '-0.050', '0.250', '2026-10-19T10:10:00Z', { reason: [2, 'Merma'] }),
      mov('adjust', '-1', '0', '2026-10-19T10:20:00Z', { reason: [3, 'Corrección de conteo'] }),
    ];
    const m = computeInventoryMetrics(facts, latestPerPlaceAndProduct(facts), { timeZone: TZ, groupBy: 'day', range });
    expect(m.by_direction).toEqual([
      { direction: 'in', movement_count: 2, total_delta: '0.300' },
      { direction: 'out', movement_count: 1, total_delta: '-0.050' },
      { direction: 'adjust', movement_count: 1, total_delta: '-1.000' },
    ]);
    expect(m.by_reason.map((r) => [r.direction, r.reason_name, r.total_delta])).toEqual([
      ['adjust', 'Corrección de conteo', '-1.000'],
      ['in', 'Compra', '0.300'],
      ['out', 'Merma', '-0.050'],
    ]);
    const moved = m.by_period.filter((p) => p.movement_count > 0);
    expect(moved).toHaveLength(1);
    expect(m.by_period.every((p) => p.movement_count > 0 || (p.in_delta === '0.000' && p.out_delta === '0.000'))).toBe(true);
    expect(moved[0]).toMatchObject({ movement_count: 4, in_delta: '0.300', out_delta: '-0.050', adjust_delta: '-1.000' });
  });
  it('desempata movimientos simultáneos de forma determinista', () => {
    const a = mov('in', '1', '1', '2026-10-19T10:00:00Z');
    const b = mov('in', '1', '2', '2026-10-19T10:00:00Z');
    expect(latestPerPlaceAndProduct([a, b])[0]!.movementId).toBe(latestPerPlaceAndProduct([b, a])[0]!.movementId);
  });
});
