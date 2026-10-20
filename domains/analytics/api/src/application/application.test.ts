import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryCoreAccess,
  InMemoryProcessedEventStore,
  InMemoryServiceCallFactRepository,
  InMemoryStockMovementFactRepository,
} from '../testing/index.js';
import {
  AnalyticsEventSubscriber,
  GetInventoryMetrics,
  GetServiceCallMetrics,
  InvalidEventError,
  LocationNotFoundError,
  ProjectCommerceEvent,
  ProjectHospitalityEvent,
  RebuildProjections,
} from './index.js';
import { TenantMismatchError } from '../domain/index.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = uuid(100);
const LOC = uuid(101);
const OTHER_ORG = uuid(110);
const OTHER_LOC = uuid(111);
let seq = 5000;
const env = (type: string, payload: object, o: { org?: string; loc?: string; id?: string } = {}) => ({
  event_id: o.id ?? uuid(seq++),
  event_type: type,
  event_version: 1,
  occurred_at: '2026-10-19T15:00:00Z',
  organization_id: o.org ?? ORG,
  location_id: o.loc ?? LOC,
  aggregate_id: uuid(7),
  correlation_id: uuid(8),
  causation_id: null,
  payload,
});

const CALL = uuid(1);
const created = (o?: Parameters<typeof env>[2], call = CALL, table = 2, createdAt = '2026-10-19T15:00:00Z', zone: [string, string] | null = [uuid(3), 'Terraza']) =>
  env('hospitality.service_call.created', { service_call_id: call, table_id: uuid(table), table_label: `M${table}`, zone_id: zone?.[0] ?? null, zone_name: zone?.[1] ?? null, call_type: 'attention', created_at: createdAt }, o);
const acked = (at = '2026-10-19T15:01:00Z', call = CALL, presses = 2, o?: Parameters<typeof env>[2]) =>
  env('hospitality.service_call.acknowledged', { service_call_id: call, acknowledged_at: at, acknowledged_by: uuid(9), press_count: presses }, o);
const completed = (at = '2026-10-19T15:03:00Z', call = CALL, presses = 3, o?: Parameters<typeof env>[2]) =>
  env('hospitality.service_call.completed', { service_call_id: call, completed_at: at, completed_by: uuid(9), press_count: presses }, o);
const stock = (type: 'received' | 'issued' | 'adjusted', delta: string, balance: string, at: string, o: { id?: string; org?: string; loc?: string; reason?: string } = {}) =>
  env(`commerce.stock.${type}`, {
    movement_id: o.id ?? uuid(seq++), stock_location_id: uuid(400), product_id: uuid(500), product_name: 'Ron', reason_id: uuid(600),
    reason_name: o.reason ?? 'Compra', delta, balance_after: balance, occurred_at: at, actor_user_id: uuid(9),
  }, o);

function setup() {
  const calls = new InMemoryServiceCallFactRepository();
  const stocks = new InMemoryStockMovementFactRepository();
  const processed = new InMemoryProcessedEventStore();
  const core = new InMemoryCoreAccess()
    .add({ id: LOC, organizationId: ORG, timezone: 'America/Bogota', active: true })
    .add({ id: OTHER_LOC, organizationId: OTHER_ORG, timezone: 'America/Bogota', active: true });
  const hospitality = new ProjectHospitalityEvent(calls, processed);
  const commerce = new ProjectCommerceEvent(stocks, processed);
  const subscriber = new AnalyticsEventSubscriber(hospitality, commerce);
  return {
    calls, stocks, processed, subscriber, hospitality, commerce,
    callMetrics: new GetServiceCallMetrics(calls, core),
    stockMetrics: new GetInventoryMetrics(stocks, core),
    rebuild: new RebuildProjections(calls, stocks, processed, subscriber),
  };
}
type Ctx = ReturnType<typeof setup>;

// 22:00 del 19 en Bogotá (ya es 20 en UTC)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T03:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const today = { range: 'today' as const, group_by: 'day' as const };

describe('proyección de llamados', () => {
  let c: Ctx;
  beforeEach(() => (c = setup()));

  it('proyecta created → acknowledged → completed', async () => {
    for (const e of [created(), acked(), completed()]) expect(await c.hospitality.execute(e)).toBe('applied');
    const m = await c.callMetrics.execute({ organizationId: ORG, locationId: LOC, query: today });
    expect(m.totals).toMatchObject({ calls: 1, completed: 1, repeated_presses: 2 });
    expect(m.time_to_acknowledge.average_seconds).toBe(60);
    expect(m.time_to_complete.median_seconds).toBe(180);
  });

  it('deduplica por event_id (at-least-once)', async () => {
    const e = created();
    expect(await c.hospitality.execute(e)).toBe('applied');
    expect(await c.hospitality.execute(e)).toBe('duplicate');
    expect(await c.subscriber.project(e)).toBe('duplicate');
    expect(c.calls.items.size).toBe(1);
  });

  it('tolera desorden: completed y acknowledged antes que created', async () => {
    const m1 = setup();
    for (const e of [completed(), acked(), created()]) await m1.subscriber.handle(e);
    const m2 = setup();
    for (const e of [created(), acked(), completed()]) await m2.subscriber.handle(e);
    expect(m1.calls.items.get(CALL)!.snapshot).toEqual(m2.calls.items.get(CALL)!.snapshot);
    const before = setup();
    await before.subscriber.handle(acked());
    const r = await before.callMetrics.execute({ organizationId: ORG, locationId: LOC, query: today });
    expect(r.totals.calls).toBe(0); // un fact sin created aún no cuenta
  });

  it('reentrega del mismo hecho con otro event_id no cambia el resultado', async () => {
    await c.hospitality.execute(created());
    await c.hospitality.execute(acked());
    await c.hospitality.execute(acked());
    expect(c.calls.items.get(CALL)!.snapshot.pressCount).toBe(2);
  });

  it('rechaza payload inválido y no lo marca procesado', async () => {
    const bad = created();
    (bad.payload as { call_type: string }).call_type = 'bill';
    await expect(c.hospitality.execute(bad)).rejects.toThrow(InvalidEventError);
    expect(c.processed.ids.size).toBe(0);
    await expect(c.subscriber.handle({ nope: true })).rejects.toThrow(InvalidEventError);
  });

  it('ignora eventos de tipos desconocidos', async () => {
    expect(await c.subscriber.project(env('core.user.created', {}))).toBe('ignored');
    expect(await c.hospitality.execute(env('hospitality.table.updated', {}))).toBe('ignored');
  });

  it('un evento de otro local con el mismo llamado falla (aislamiento)', async () => {
    await c.hospitality.execute(created());
    await expect(c.hospitality.execute(acked('2026-10-19T15:01:00Z', CALL, 1, { org: OTHER_ORG, loc: OTHER_LOC }))).rejects.toThrow(TenantMismatchError);
  });
});

describe('métricas de llamados', () => {
  let c: Ctx;
  beforeEach(async () => {
    c = setup();
    // M2 / Terraza dentro de hoy local; M3 sin zona; uno de ayer local (04:59Z del 19 = 23:59 del 18)
    await c.subscriber.handle(created(undefined, uuid(1), 2));
    await c.subscriber.handle(created(undefined, uuid(21), 3, '2026-10-19T16:00:00Z', null));
    await c.subscriber.handle(created(undefined, uuid(22), 2, '2026-10-19T04:59:59Z'));
    await c.subscriber.handle(created(undefined, uuid(23), 2, '2026-10-19T05:00:00Z'));
    await c.subscriber.handle(created({ org: OTHER_ORG, loc: OTHER_LOC }, uuid(24), 2, '2026-10-19T15:00:00Z'));
  });
  const run = (query: object, org = ORG, loc = LOC) => c.callMetrics.execute({ organizationId: org, locationId: loc, query: { group_by: 'day', ...query } as never });

  it('hoy local excluye 23:59:59 de ayer e incluye 00:00 de hoy', async () => {
    const m = await run({ range: 'today' });
    expect(m.totals.calls).toBe(3);
    const y = await run({ range: 'yesterday' });
    expect(y.totals.calls).toBe(1);
    expect(y.by_period[0]!.bucket_label).toBe('2026-10-18');
  });
  it('filtra por zona y por mesa', async () => {
    expect((await run({ range: 'today', zone_id: uuid(3) })).totals.calls).toBe(2);
    expect((await run({ range: 'today', table_id: uuid(3) })).totals.calls).toBe(1);
    expect((await run({ range: 'today', zone_id: uuid(3), table_id: uuid(3) })).totals.calls).toBe(0);
  });
  it('rango custom y 7 días', async () => {
    expect((await run({ range: 'custom', from: '2026-10-18', to: '2026-10-18' })).totals.calls).toBe(1);
    expect((await run({ range: 'last_7_days' })).totals.calls).toBe(4);
  });
  it('aísla negocios: cada local ve solo lo suyo y no puede consultar locales ajenos', async () => {
    expect((await run({ range: 'today' }, OTHER_ORG, OTHER_LOC)).totals.calls).toBe(1);
    await expect(run({ range: 'today' }, ORG, OTHER_LOC)).rejects.toThrow(LocationNotFoundError);
    await expect(run({ range: 'today' }, ORG, uuid(999))).rejects.toThrow(LocationNotFoundError);
  });
});

describe('proyección e inventario', () => {
  let c: Ctx;
  beforeEach(() => (c = setup()));
  const run = (query: object = {}, org = ORG, loc = LOC) => c.stockMetrics.execute({ organizationId: org, locationId: loc, query: { range: 'today', group_by: 'day', ...query } as never });

  it('proyecta received/issued/adjusted, deduplica y calcula saldo por motivo', async () => {
    const recv = stock('received', '10.000', '10.000', '2026-10-19T14:00:00Z');
    await c.subscriber.handle(recv);
    await c.subscriber.handle(recv);
    await c.subscriber.handle(stock('issued', '-3.500', '6.500', '2026-10-19T15:00:00Z', { reason: 'Merma' }));
    await c.subscriber.handle(stock('adjusted', '-0.500', '6.000', '2026-10-19T16:00:00Z', { reason: 'Corrección de conteo' }));
    expect(c.stocks.items.size).toBe(3);
    const m = await run();
    expect(m.by_direction.map((d) => [d.direction, d.movement_count, d.total_delta])).toEqual([['in', 1, '10.000'], ['out', 1, '-3.500'], ['adjust', 1, '-0.500']]);
    expect(m.by_reason.map((r) => r.reason_name)).toEqual(['Corrección de conteo', 'Compra', 'Merma']);
    expect(m.balances).toEqual([expect.objectContaining({ product_name: 'Ron', balance: '6.000' })]);
  });
  it('el saldo actual no depende del rango; los movimientos sí', async () => {
    await c.subscriber.handle(stock('received', '4', '4', '2026-10-01T14:00:00Z'));
    const m = await run();
    expect(m.by_direction.every((d) => d.movement_count === 0)).toBe(true);
    expect(m.balances[0]!.balance).toBe('4.000');
  });
  it('tolera desorden: el saldo es el del último occurred_at aunque llegue antes', async () => {
    await c.subscriber.handle(stock('issued', '-3', '7', '2026-10-19T15:00:00Z'));
    await c.subscriber.handle(stock('received', '10', '10', '2026-10-19T14:00:00Z'));
    expect((await run()).balances[0]!.balance).toBe('7.000');
  });
  it('rechaza received con delta negativo', async () => {
    await expect(c.subscriber.handle(stock('received', '-1', '0', '2026-10-19T14:00:00Z'))).rejects.toThrow(InvalidEventError);
  });
  it('aísla por local y negocio', async () => {
    await c.subscriber.handle(stock('received', '2', '2', '2026-10-19T14:00:00Z'));
    await c.subscriber.handle(stock('received', '9', '9', '2026-10-19T14:00:00Z', { org: OTHER_ORG, loc: OTHER_LOC }));
    expect((await run()).balances[0]!.balance).toBe('2.000');
    expect((await run({}, OTHER_ORG, OTHER_LOC)).balances[0]!.balance).toBe('9.000');
    await expect(run({}, ORG, OTHER_LOC)).rejects.toThrow(LocationNotFoundError);
  });
  it('filtra por producto', async () => {
    await c.subscriber.handle(stock('received', '2', '2', '2026-10-19T14:00:00Z'));
    expect((await run({ product_id: uuid(999) })).balances).toEqual([]);
  });
});

describe('RebuildProjections', () => {
  it('vacía y reprocesa un historial (también asíncrono) dejando las mismas métricas', async () => {
    const c = setup();
    const history = [created(), acked(), completed(), stock('received', '3', '3', '2026-10-19T14:00:00Z')];
    for (const e of history) await c.subscriber.handle(e);
    const before = await c.callMetrics.execute({ organizationId: ORG, locationId: LOC, query: today });
    // basura previa que debe desaparecer
    await c.subscriber.handle(created(undefined, uuid(77), 4));

    async function* stream() {
      for (const e of [...history, history[0]!, env('core.x', {})]) yield e;
    }
    const summary = await c.rebuild.execute(stream());
    expect(summary).toEqual({ total: 6, applied: 4, duplicates: 1, ignored: 1 });
    expect(c.calls.items.has(uuid(77))).toBe(false);
    expect(await c.callMetrics.execute({ organizationId: ORG, locationId: LOC, query: today })).toEqual(before);
    expect(await c.rebuild.execute(history)).toMatchObject({ applied: 4 });
  });
});
