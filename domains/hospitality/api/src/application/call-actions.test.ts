import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConcurrencyConflictError, LocationUnavailableError, NotFoundError } from '../domain/errors.js';
import { canSeeCall } from '../domain/service-calls/visibility.js';
import { buildWorld, seedTableWithButton, type World } from '../testing/world.js';

let w: World;
let callId: string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  w = buildWorld();
  await seedTableWithButton(w, { zone: 'Terraza' });
  callId = (await w.registerPress.registerPress(w.press())).serviceCallId!;
});
afterEach(() => vi.useRealTimers());

describe('AcknowledgeCall / CompleteCall', () => {
  it('flujo completo: persiste transiciones y eventos con press_count final y avisa', async () => {
    vi.setSystemTime(new Date('2026-10-19T10:01:00Z'));
    await w.acknowledge.execute({ ...w.ctx, callId });
    await w.complete.execute({ ...w.ctx, callId });
    expect(w.calls.all()[0]).toMatchObject({ status: 'completed', completedBy: w.ctx.actorUserId });
    expect(w.calls.transitions.map((t) => t.action)).toEqual(['create', 'acknowledge', 'complete']);
    expect(w.calls.outbox.map((e) => e.eventType)).toEqual([
      'hospitality.service_call.created',
      'hospitality.service_call.acknowledged',
      'hospitality.service_call.completed',
    ]);
    expect(w.notifications.sent.map((n) => n.change)).toEqual(['created', 'acknowledged', 'completed']);
  });

  it('rechaza saltos de estado con el estado vigente (ConcurrencyConflictError)', async () => {
    const other = { ...w.ctx, actorUserId: crypto.randomUUID() };
    const conflict = await w.complete.execute({ ...w.ctx, callId }).catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ConcurrencyConflictError);
    expect((conflict as ConcurrencyConflictError).current?.status).toBe('pending');
    await w.acknowledge.execute({ ...w.ctx, callId });
    await expect(w.acknowledge.execute({ ...other, callId })).rejects.toBeInstanceOf(ConcurrencyConflictError);
    await expect(w.complete.execute({ ...w.ctx, callId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    await w.complete.execute({ ...w.ctx, callId });
    await expect(w.complete.execute({ ...other, callId })).rejects.toBeInstanceOf(ConcurrencyConflictError);
  });

  it('idempotente: el mismo actor repitiendo la acción recibe el estado vigente sin nueva transición ni aviso', async () => {
    await w.acknowledge.execute({ ...w.ctx, callId });
    const again = await w.acknowledge.execute({ ...w.ctx, callId });
    expect(again.status).toBe('in_progress');
    await w.complete.execute({ ...w.ctx, callId });
    expect((await w.complete.execute({ ...w.ctx, callId })).status).toBe('completed');
    expect(w.calls.transitions.map((t) => t.action)).toEqual(['create', 'acknowledge', 'complete']);
    expect(w.notifications.sent.map((n) => n.change)).toEqual(['created', 'acknowledged', 'completed']);
  });

  it('idempotente también si pierde la carrera contra su propio doble envío', async () => {
    w.calls.beforeSave = async () => {
      w.calls.beforeSave = undefined;
      const mine = (await w.calls.findById({ ...w.ctx, id: callId }))!;
      mine.acknowledge(w.ctx.actorUserId, new Date());
      await w.calls.save(mine);
    };
    expect((await w.acknowledge.execute({ ...w.ctx, callId })).status).toBe('in_progress');
    expect(w.calls.transitions.filter((t) => t.action === 'acknowledge')).toHaveLength(1);
  });

  it('conflicto concurrente: el segundo en reconocer recibe el estado actual', async () => {
    w.calls.beforeSave = async () => {
      w.calls.beforeSave = undefined;
      const other = (await w.calls.findById({ ...w.ctx, id: callId }))!;
      other.acknowledge(crypto.randomUUID(), new Date());
      await w.calls.save(other);
    };
    const error = await w.acknowledge.execute({ ...w.ctx, callId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConcurrencyConflictError);
    expect((error as ConcurrencyConflictError).current?.status).toBe('in_progress');
    expect(w.notifications.sent.map((n) => n.change)).toEqual(['created']);
  });

  it('aislamiento por local: otro local no encuentra el llamado', async () => {
    await expect(w.acknowledge.execute({ ...w.ctx, locationId: crypto.randomUUID(), callId })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('ListActiveCalls', () => {
  const viewer = (over = {}) => ({ ...w.ctx, permissions: new Set(['hospitality.calls.read'] as const), ...over });

  it('lista activos con nombre "Zona · Mesa" y excluye completados', async () => {
    const list = await w.listActive.execute(viewer());
    expect(list).toMatchObject([{ id: callId, tableName: 'Terraza · 5', status: 'pending', pressCount: 1 }]);
    await w.acknowledge.execute({ ...w.ctx, callId });
    await w.complete.execute({ ...w.ctx, callId });
    expect(await w.listActive.execute(viewer())).toEqual([]);
  });

  it('filtra con canSeeCall: sin permiso o de otro local no ve nada', async () => {
    expect(await w.listActive.execute(viewer({ permissions: new Set() }))).toEqual([]);
    // Un local que Core no reconoce se rechaza antes de listar.
    await expect(w.listActive.execute(viewer({ locationId: crypto.randomUUID() }))).rejects.toBeInstanceOf(LocationUnavailableError);
    expect(canSeeCall(viewer(), (await w.calls.listActive(w.ctx))[0]!)).toBe(true);
  });
});
