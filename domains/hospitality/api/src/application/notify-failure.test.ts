import { describe, expect, it, vi } from 'vitest';
import { PublishLayout } from './layouts.js';
import { notifyAfterSave } from './support.js';
import type { NotificationPort } from './ports/index.js';
import { buildWorld, seedTableWithButton } from '../testing/world.js';

describe('fallas de publicación realtime (ARC-04)', () => {
  it('notifyAfterSave registra la falla estructurada y no la propaga', async () => {
    const w = buildWorld();
    await seedTableWithButton(w, { zone: 'Terraza' });
    const callId = (await w.registerPress.registerPress(w.press())).serviceCallId!;
    const error = vi.fn();
    const boom: NotificationPort = { callChanged: () => Promise.reject(new Error('socket caído')) };
    await expect(notifyAfterSave(boom, 'acknowledged', w.calls.all()[0]!, { error })).resolves.toBeUndefined();
    expect(JSON.parse(error.mock.calls[0]![0] as string)).toEqual({
      event: 'realtime.service_call.acknowledged.notify_failed',
      organization_id: w.ctx.organizationId, location_id: w.ctx.locationId, resource_id: callId, error: 'socket caído',
    });
  });

  it('PublishLayout registra la falla del aviso y devuelve el plano publicado', async () => {
    const w = buildWorld();
    const error = vi.fn();
    const published = { version: 3 };
    const layouts = { withPublishTx: () => Promise.resolve(published) } as never;
    const notifier = { layoutPublished: () => Promise.reject(new Error('sin socket')) };
    const result = await new PublishLayout(w.core, layouts, notifier, { error }).execute({ ...w.ctx, zoneId: null, revision: 1 });
    expect(result).toBe(published);
    expect(JSON.parse(error.mock.calls[0]![0] as string)).toMatchObject({
      event: 'realtime.layout.publish_notify_failed', organization_id: w.ctx.organizationId, location_id: w.ctx.locationId, resource_id: 'sin_zona@v3', error: 'sin socket',
    });
  });
});
