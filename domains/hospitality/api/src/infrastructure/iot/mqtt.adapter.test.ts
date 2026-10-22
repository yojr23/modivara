import { describe, expect, it, vi } from 'vitest';
import { newId } from '@modivara/core-contracts';
import { mqttTopic } from '@modivara/hospitality-contracts';
import type { GatewayPressAdapter } from '../gateway-press.adapter.js';
import type { GatewayIngest } from './gateway-ingest.js';
import { GatewayRateLimiter } from './gateway-rate-limiter.js';
import { MqttAdapter } from './mqtt.adapter.js';

describe('MqttAdapter: topes en vuelo', () => {
  it('un gateway que inunda no impide que otro procese su pulsación', async () => {
    const [a, b] = [newId(), newId()];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const findActive = vi.fn(async (id: string) => {
      if (id === a) await gate; // los de A se quedan en vuelo
      return { id } as never;
    });
    const press = vi.fn(async () => undefined);
    const adapter = new MqttAdapter(null, { findActive } as unknown as GatewayPressAdapter, { press } as unknown as GatewayIngest,
      new GatewayRateLimiter({ burst: 1000 }), { perGateway: 3, global: 4 });
    const body = Buffer.from('{"device_code":"x"}');
    const flood = Array.from({ length: 20 }, () => adapter.handle(mqttTopic(a, 'press'), body));
    await adapter.handle(mqttTopic(b, 'press'), body);
    expect(press).toHaveBeenCalledTimes(1); // B pasó mientras A seguía en vuelo
    release();
    await Promise.all(flood);
    expect(press).toHaveBeenCalledTimes(1 + 3); // de A solo entraron 3 (tope por gateway)
  });
});
