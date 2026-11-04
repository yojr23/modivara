import { beforeEach, describe, expect, it } from 'vitest';
import { toEventEnvelope } from '@modivara/core-contracts';
import { platformActionRecordedEventSchema } from '@modivara/hospitality-contracts';
import { GatewayInUseError } from '../domain/errors.js';
import { buildWorld, type World } from '../testing/world.js';

let w: World;
beforeEach(() => { w = buildWorld(); });

const payloads = (events: { payload: unknown }[]) => events.map((e) => e.payload);

describe('auditoría de acciones del superadmin: el evento queda pendiente con actor y recurso', () => {
  it('crear y desactivar gateway', async () => {
    const { gateway, plainKey } = await w.createGateway.execute({ ...w.ctx, name: 'GW' });
    expect(payloads(w.gateways.outbox)).toEqual([
      { action: 'gateway.created', actor_user_id: w.ctx.actorUserId, target_type: 'gateway', target_id: gateway.id, details: { name: 'GW' } },
    ]);
    expect(JSON.stringify(w.gateways.outbox)).not.toContain(plainKey);
    const spare = (await w.createGateway.execute({ ...w.ctx, name: 'GW2' })).gateway;
    await w.deactivateGateway.execute({ ...w.ctx, gatewayId: spare.id });
    const last = w.gateways.outbox.at(-1)!;
    expect(last).toMatchObject({ organizationId: w.ctx.organizationId, locationId: w.ctx.locationId, aggregateId: spare.id });
    expect(last.payload).toMatchObject({ action: 'gateway.deactivated', target_id: spare.id });
  });

  it('desactivar rechazado no deja evento', async () => {
    const { gateway } = await w.createGateway.execute({ ...w.ctx, name: 'GW' });
    const t = await w.createTable.execute({ ...w.ctx, label: '1' });
    const d = await w.registerDevice.execute({ ...w.ctx, code: 'B1' });
    await w.assignDevice.execute({ ...w.ctx, deviceId: d.id, tableId: t.id });
    await expect(w.deactivateGateway.execute({ ...w.ctx, gatewayId: gateway.id })).rejects.toBeInstanceOf(GatewayInUseError);
    expect(w.gateways.outbox).toHaveLength(1);
  });

  it('crear, asignar y desasignar dispositivo; los eventos cumplen el contrato', async () => {
    const t = await w.createTable.execute({ ...w.ctx, label: '1' });
    const d = await w.registerDevice.execute({ ...w.ctx, code: 'B1', model: 'M' });
    await w.assignDevice.execute({ ...w.ctx, deviceId: d.id, tableId: t.id });
    await w.unassignDevice.execute({ ...w.ctx, deviceId: d.id });
    expect(w.devices.outbox.map((e) => e.payload)).toEqual([
      { action: 'device.created', actor_user_id: w.ctx.actorUserId, target_type: 'device', target_id: d.id, details: { code: 'B1', model: 'M' } },
    ]);
    expect(w.assignments.outbox.map((e) => [(e.payload as { action: string }).action, (e.payload as { target_id: string }).target_id])).toEqual([
      ['device.assigned', d.id], ['device.unassigned', d.id],
    ]);
    for (const e of [...w.devices.outbox, ...w.assignments.outbox]) expect(platformActionRecordedEventSchema.safeParse(toEventEnvelope(e)).success).toBe(true);
    expect(payloads(w.assignments.outbox)[0]).toMatchObject({ details: { tableId: t.id } });
  });
});
