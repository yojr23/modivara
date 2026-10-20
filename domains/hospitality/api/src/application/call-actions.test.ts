import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConcurrencyConflictError, InvalidTransitionError, NotFoundError } from '../domain/errors.js';
import { canSeeCall } from '../domain/service-calls/visibility.js';
import { buildWorld, seedTableWithButton, type World } from '../testing/world.js';

let w: World;
let callId: string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  w = buildWorld();
  await seedTableWithButton(w, { zone: 'Terraza' });
  callId = (await w.registerPress.execute(w.press())).serviceCallId!;
});
afterEach(() => vi.useRealTimers());

describe('AcknowledgeCall / CompleteCall', () => {
  it('flujo completo: persiste transiciones y eventos con press_count final y avisa', async () => {
    vi.setSystemTime(new Date('2026-10-19T10:01:00Z'));
    await w.acknowledge.execute({ ...w.ctx, callId });
    await w.complete.execute({ ...w.ctx, callId });
    expect(w.calls.all()[0]).toMatchObject({ status: 'completed', completedBy: w.ctx.actorId });
    expect(w.calls.transitions.map((t) => t.action)).toEqual(['create', 'acknowledge', 'complete']);
    expect(w.calls.outbox.map((e) => e.type)).toEqual([
      'hospitality.service_call.created',
      'hospitality.service_call.acknowledged',
      'hospitality.service_call.completed',
    ]);
    expect(w.notifications.sent.map((n) => n.change)).toEqual(['created', 'acknowledged', 'completed']);
  });

  it('rechaza saltos de estado', async () => {
    await expect(w.complete.execute({ ...w.ctx, callId })).rejects.toBeInstanceOf(InvalidTransitionError);
    await w.acknowledge.execute({ ...w.ctx, callId });
    await expect(w.acknowledge.execute({ ...w.ctx, callId })).rejects.toBeInstanceOf(InvalidTransitionError);
    await w.complete.execute({ ...w.ctx, callId });
    await expect(w.complete.execute({ ...w.ctx, callId })).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('conflicto concurrente: el segundo en reconocer recibe el estado actual', async () => {
    w.calls.beforeSave = async () => {
      w.calls.beforeSave = undefined;
      const other = (await w.calls.findById(callId, w.ctx.locationId))!;
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
  const viewer = (over = {}) => ({ userId: 'u', locationId: w.ctx.locationId, permissions: new Set(['hospitality.calls.read'] as const), ...over });

  it('lista activos con nombre "Zona · Mesa" y excluye completados', async () => {
    const list = await w.listActive.execute({ viewer: viewer() });
    expect(list).toMatchObject([{ id: callId, tableName: 'Terraza · 5', status: 'pending', pressCount: 1 }]);
    await w.acknowledge.execute({ ...w.ctx, callId });
    await w.complete.execute({ ...w.ctx, callId });
    expect(await w.listActive.execute({ viewer: viewer() })).toEqual([]);
  });

  it('filtra con canSeeCall: sin permiso o de otro local no ve nada', async () => {
    expect(await w.listActive.execute({ viewer: viewer({ permissions: new Set() }) })).toEqual([]);
    expect(await w.listActive.execute({ viewer: viewer({ locationId: crypto.randomUUID() }) })).toEqual([]);
    expect(canSeeCall(viewer(), (await w.calls.listActive(w.ctx.locationId))[0]!)).toBe(true);
  });
});
