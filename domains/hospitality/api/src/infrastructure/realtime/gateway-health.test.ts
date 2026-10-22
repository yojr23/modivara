import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gateway } from '../../domain/devices/gateway.js';
import { DetectGatewayHealthChanges } from '../../application/gateway-health.js';
import type { GatewayHealthChange } from '../../application/ports/index.js';
import { InMemoryGatewayRepository } from '../../testing/in-memory.js';
import { GatewayHealthMonitor } from './gateway-health.js';

const T0 = new Date('2026-10-19T10:00:00Z');
const org = crypto.randomUUID();
const loc = crypto.randomUUID();
let repo: InMemoryGatewayRepository;
let sent: GatewayHealthChange[];
let monitor: GatewayHealthMonitor;
let gateway: Gateway;

const beat = async () => {
  gateway.recordHeartbeat(new Date());
  await repo.save(gateway);
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  repo = new InMemoryGatewayRepository();
  sent = [];
  gateway = Gateway.create({ organizationId: org, locationId: loc, name: 'GW', createdBy: 'u', now: T0 }).gateway;
  await beat();
  monitor = new GatewayHealthMonitor(new DetectGatewayHealthChanges(repo, { connectivityChanged: async (c) => void sent.push(c) }), 1_000);
  monitor.onModuleInit();
});
afterEach(() => {
  monitor.onModuleDestroy();
  vi.useRealTimers();
});

describe('F3-11 salud de gateways', () => {
  it('a 90 s sigue conectado; a 91 s avisa una sola vez y no repite en cada ciclo', async () => {
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent).toEqual([{ organizationId: org, locationId: loc, connected: false, disconnectedGatewayIds: [gateway.id] }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toHaveLength(1);
  });

  it('al volver el heartbeat avisa la recuperación una sola vez', async () => {
    await vi.advanceTimersByTimeAsync(91_000);
    await beat();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent.map((c) => c.connected)).toEqual([false, true]);
    expect(sent[1]!.disconnectedGatewayIds).toEqual([]);
  });

  it('un gateway desactivado ya no cuenta', async () => {
    await vi.advanceTimersByTimeAsync(91_000);
    const props = gateway.toProps();
    await repo.save(Gateway.restore({ ...props, deactivatedAt: new Date() }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent.map((c) => c.connected)).toEqual([false]);
  });

  it('un fallo del ciclo no detiene la tarea', async () => {
    const failing = vi.spyOn(repo, 'listActive').mockRejectedValueOnce(new Error('db'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(failing).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(91_000);
    expect(sent).toHaveLength(1);
  });
});
