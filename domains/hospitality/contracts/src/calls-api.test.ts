import { describe, expect, it } from 'vitest';
import { listServiceCallsQuerySchema } from './calls-api.js';
import { gatewayIdFromTopic, mqttTopic } from './gateway.js';

describe('API de llamados y tópicos', () => {
  it('por defecto lista los activos con límite 50', () => {
    expect(listServiceCallsQuerySchema.parse({})).toMatchObject({ status: 'active', limit: 50 });
    expect(listServiceCallsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('tópicos MQTT de ida y vuelta, y rechazo de formatos ajenos', () => {
    expect(gatewayIdFromTopic(mqttTopic('gw-1', 'press'))).toEqual({ gatewayId: 'gw-1', kind: 'press' });
    expect(gatewayIdFromTopic('modivara/gw/gw-1/press/extra')).toBeNull();
    expect(gatewayIdFromTopic('otra/gw/gw-1/press')).toBeNull();
  });
});
