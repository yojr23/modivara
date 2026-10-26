import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffMs, OutboxPoller, retryFailed, newId, type IntegrationEvent, type IntegrationEventSubscriber, type OutboxPollerOptions,
} from '@modivara/core-contracts';
import { hospitalityPrismaForTests, resetHospitality, tenant } from '../../testing/integration.js';
import { Device } from '../../domain/devices/device.js';
import { ServiceCall } from '../../domain/service-calls/service-call.js';
import { DiningTable } from '../../domain/tables/dining-table.js';
import { PrismaDeviceRepository } from '../prisma/prisma-device-repository.js';
import { PrismaDiningTableRepository } from '../prisma/prisma-dining-table-repository.js';
import { PrismaServiceCallRepository } from '../prisma/prisma-service-call-repository.js';

const db = hospitalityPrismaForTests();
const t = tenant();
const FAST: Partial<OutboxPollerOptions> = { baseBackoffMs: 200, maxBackoffMs: 5000, intervalMs: 20 };

beforeEach(() => resetHospitality(db));
afterAll(() => db.$disconnect());

/** Un llamado creado por el repositorio real: deja su evento `created` en el outbox, dentro de la misma transacción. */
async function publishCall() {
  const table = DiningTable.create({ ...t, label: `m${Math.random()}`, createdBy: newId(), now: new Date() });
  await new PrismaDiningTableRepository(db).save(table);
  const call = ServiceCall.create({
    ...t, table: { id: table.id, label: table.label, zoneId: null, zoneName: null }, callType: 'attention', deviceEventId: newId(), correlationId: newId(), now: new Date(),
  });
  await new PrismaServiceCallRepository(db).save(call);
  return call;
}

const recorder = (over: Partial<IntegrationEventSubscriber> = {}) => {
  const seen: IntegrationEvent[] = [];
  const subscriber: IntegrationEventSubscriber = { name: 'rec', handles: () => true, handle: async (e) => void seen.push(e), ...over };
  return { seen, subscriber };
};
const row = async () => (await db.outboxEvent.findMany())[0]!;

describe('OutboxPoller', () => {
  it('entrega el evento publicado tras el commit con el sobre del kernel y lo marca despachado (sin borrarlo)', async () => {
    const call = await publishCall();
    const { seen, subscriber } = recorder();
    await new OutboxPoller(db, [subscriber], FAST).tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      event_id: (await row()).id, event_type: 'hospitality.service_call.created', event_version: 1, organization_id: t.organizationId,
      location_id: t.locationId, aggregate_id: call.id, payload: { service_call_id: call.id, call_type: 'attention' },
    });
    expect(await row()).toMatchObject({ attempts: 1, lastError: null });
    expect((await row()).dispatchedAt).toBeInstanceOf(Date);
    await new OutboxPoller(db, [subscriber], FAST).tick();
    expect(seen).toHaveLength(1); // ya despachado: no se repite
    expect(await db.outboxEvent.count()).toBe(1);
  });

  it('solo entrega a quien dice manejar el tipo; con cero suscriptores igual marca despachado', async () => {
    await publishCall();
    const { seen, subscriber } = recorder({ handles: (type) => type === 'otro.tipo' });
    await new OutboxPoller(db, [subscriber], FAST).tick();
    expect(seen).toEqual([]);
    expect((await row()).dispatchedAt).not.toBeNull();
    await resetHospitality(db);
    await publishCall();
    await new OutboxPoller(db, [], FAST).tick();
    expect((await row()).dispatchedAt).not.toBeNull();
  });

  it('suscriptor que falla 2 veces: reintento con espera creciente y a la tercera se despacha', async () => {
    await publishCall();
    const handle = vi.fn<(e: IntegrationEvent) => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValue(undefined);
    const poller = new OutboxPoller(db, [{ name: 'flaky', handles: () => true, handle }], FAST);

    const t1 = Date.now();
    await poller.tick();
    expect(await row()).toMatchObject({ attempts: 1, lastError: 'boom 1', dispatchedAt: null });
    expect((await row()).nextAttemptAt.getTime() - t1).toBeGreaterThanOrEqual(190); // 1ª espera: base
    await poller.tick();
    expect(handle).toHaveBeenCalledTimes(1); // aún no vence: no se reintenta antes de tiempo

    await new Promise((r) => setTimeout(r, 250));
    const t2 = Date.now();
    await poller.tick();
    expect(await row()).toMatchObject({ attempts: 2, lastError: 'boom 2', dispatchedAt: null });
    expect((await row()).nextAttemptAt.getTime() - t2).toBeGreaterThanOrEqual(390); // 2ª espera: el doble

    await new Promise((r) => setTimeout(r, 450));
    await poller.tick();
    expect(handle).toHaveBeenCalledTimes(3);
    expect(await row()).toMatchObject({ attempts: 3, lastError: null });
    expect((await row()).dispatchedAt).not.toBeNull();
  });

  it('suscriptor que no responde: vence el tiempo, cuenta como fallo con espera y lo ya entregado no se revierte', async () => {
    const first = await publishCall();
    const second = await publishCall();
    const hang: IntegrationEventSubscriber = {
      name: 'colgado', handles: () => true,
      handle: (e) => (e.aggregate_id === second.id ? new Promise<void>(() => undefined) : Promise.resolve()),
    };
    const t0 = Date.now();
    expect(await new OutboxPoller(db, [hang], { ...FAST, deliveryTimeoutMs: 150 }).tick()).toBe(2);
    expect(Date.now() - t0).toBeLessThan(5000);
    const rows = await db.outboxEvent.findMany({ orderBy: { occurredAt: 'asc' } });
    const [ok, failed] = [rows.find((r) => r.aggregateId === first.id)!, rows.find((r) => r.aggregateId === second.id)!];
    expect(ok.dispatchedAt).not.toBeNull();
    expect(failed).toMatchObject({ dispatchedAt: null, attempts: 1 });
    expect(failed.lastError).toMatch(/colgado.*no respondió/);
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(t0 + 190);
  });

  it('dos pollers en paralelo no duplican la entrega (SKIP LOCKED)', async () => {
    for (let i = 0; i < 12; i++) await publishCall();
    const deliveries = new Map<string, number>();
    const slow: IntegrationEventSubscriber = {
      name: 'slow', handles: () => true,
      handle: async (e) => { await new Promise((r) => setTimeout(r, 15)); deliveries.set(e.event_id, (deliveries.get(e.event_id) ?? 0) + 1); },
    };
    const [a, b] = await Promise.all([new OutboxPoller(db, [slow], FAST).tick(), new OutboxPoller(db, [slow], FAST).tick()]);
    expect(a + b).toBe(12);
    expect(deliveries.size).toBe(12);
    expect([...deliveries.values()].every((n) => n === 1)).toBe(true);
    expect(await db.outboxEvent.count({ where: { dispatchedAt: null } })).toBe(0);
  });

  it('al reiniciar retoma los pendientes (un proceso que murió a mitad de lote no los marcó)', async () => {
    await publishCall();
    // Simula la caída: una transacción que entrega y se revierte antes de confirmar.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE outbox_events SET dispatched_at = now()`;
      throw new Error('kill');
    })).rejects.toThrow('kill');
    expect((await row()).dispatchedAt).toBeNull();
    const { seen, subscriber } = recorder();
    await new OutboxPoller(db, [subscriber], FAST).tick(); // "proceso nuevo"
    expect(seen).toHaveLength(1);
  });

  it('el ciclo periódico del ciclo de vida procesa sin solapar ciclos y se detiene al destruirse', async () => {
    await publishCall();
    const { seen, subscriber } = recorder({ handle: async (e) => { await new Promise((r) => setTimeout(r, 120)); seen.push(e); } });
    const poller = new OutboxPoller(db, [subscriber], FAST);
    poller.start();
    const first = poller.tick();
    expect(poller.tick()).toBe(first); // mismo ciclo: no hay solape
    await first;
    await poller.stop();
    expect(seen).toHaveLength(1);
    await publishCall();
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.outboxEvent.count({ where: { dispatchedAt: null } })).toBe(1); // detenido
  });

  it('tras maxAttempts fallos queda con failed_at y el poller ya no lo toma; retryFailed lo libera y se entrega', async () => {
    await publishCall();
    const handle = vi.fn<(e: IntegrationEvent) => Promise<void>>().mockRejectedValue(new Error('siempre falla'));
    const poller = new OutboxPoller(db, [{ name: 'roto', handles: () => true, handle }], { ...FAST, baseBackoffMs: 1, maxBackoffMs: 1 });
    for (let i = 0; i < 10; i++) {
      await poller.tick();
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(handle).toHaveBeenCalledTimes(10);
    expect(await row()).toMatchObject({ attempts: 10, lastError: 'siempre falla', dispatchedAt: null });
    expect((await row()).failedAt).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 10));
    expect(await poller.tick()).toBe(0);
    expect(handle).toHaveBeenCalledTimes(10); // detenido

    expect(await retryFailed(db, newId())).toBe(0); // otro id: no toca nada
    expect(await retryFailed(db, (await row()).id)).toBe(1);
    expect(await row()).toMatchObject({ failedAt: null, attempts: 0, lastError: 'siempre falla' }); // conserva el último error
    handle.mockResolvedValue(undefined);
    expect(await poller.tick()).toBe(1);
    expect((await row()).dispatchedAt).not.toBeNull();
    expect(await row()).toMatchObject({ lastError: null, failedAt: null });
    expect(await retryFailed(db)).toBe(0);
  });

  it('espera creciente con tope', () => {
    const o = { baseBackoffMs: 1000, maxBackoffMs: 5000 };
    expect([1, 2, 3, 4, 5, 20].map((n) => backoffMs(n, o))).toEqual([1000, 2000, 4000, 5000, 5000, 5000]);
  });
});
