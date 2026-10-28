import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationUnavailableError, NotFoundError } from '../domain/errors.js';
import { buildWorld, seedTableWithButton, type World } from '../testing/world.js';

let w: World;
let callId: string;
let input: { organizationId: string; locationId: string; actorUserId: string; permissions: ReadonlySet<'hospitality.calls.read'>; callId: string };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T10:00:00Z'));
  w = buildWorld();
  await seedTableWithButton(w, { zone: 'Terraza' });
  callId = (await w.registerPress.registerPress(w.press())).serviceCallId!;
  input = { ...w.ctx, permissions: new Set(['hospitality.calls.read']), callId };
});
afterEach(() => vi.useRealTimers());

describe('GetServiceCall', () => {
  it('devuelve el llamado con transiciones en orden y nombres de quien reconoció y cerró', async () => {
    const ana = crypto.randomUUID(), beto = crypto.randomUUID();
    w.core.addUser(ana, w.ctx.organizationId, 'Ana');
    w.core.addUser(beto, w.ctx.organizationId, 'Beto');
    vi.setSystemTime(new Date('2026-10-19T10:01:00Z'));
    await w.acknowledge.execute({ ...w.ctx, actorUserId: ana, callId });
    vi.setSystemTime(new Date('2026-10-19T10:05:00Z'));
    await w.complete.execute({ ...w.ctx, actorUserId: beto, callId });

    const d = await w.getCall.execute(input);
    expect(d).toMatchObject({ id: callId, status: 'completed', acknowledged_by_name: 'Ana', completed_by_name: 'Beto' });
    expect(d.transitions.map((t) => [t.action, t.from_status, t.to_status, t.actor_name])).toEqual([
      ['create', null, 'pending', null],
      ['acknowledge', 'pending', 'in_progress', 'Ana'],
      ['complete', 'in_progress', 'completed', 'Beto'],
    ]);
    expect(d.transitions.map((t) => t.occurred_at)).toEqual(['2026-10-19T10:00:00.000Z', '2026-10-19T10:01:00.000Z', '2026-10-19T10:05:00.000Z']);
    expect(d.transitions[0]!.device_event_id).toEqual(expect.any(String));
  });

  it('nombre null si core no puede resolver al actor', async () => {
    await w.acknowledge.execute({ ...w.ctx, callId });
    expect((await w.getCall.execute(input)).acknowledged_by_name).toBeNull();
  });

  it('404 en id desconocido o sin permiso de lectura; local/negocio ajeno no disponible', async () => {
    await expect(w.getCall.execute({ ...input, locationId: crypto.randomUUID() })).rejects.toBeInstanceOf(LocationUnavailableError);
    await expect(w.getCall.execute({ ...input, callId: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.getCall.execute({ ...input, permissions: new Set() })).rejects.toBeInstanceOf(NotFoundError);
    await expect(w.getCall.execute({ ...input, organizationId: crypto.randomUUID() })).rejects.toBeInstanceOf(LocationUnavailableError);
  });
});
