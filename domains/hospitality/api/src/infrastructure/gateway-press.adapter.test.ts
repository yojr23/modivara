import { describe, expect, it } from 'vitest';
import { Gateway } from '../domain/devices/gateway.js';
import { InMemoryGatewayRepository } from '../testing/in-memory.js';
import { ButtonSignalTranslator, GatewayPressAdapter, InvalidGatewayKeyError } from './gateway-press.adapter.js';

const setup = async () => {
  const repo = new InMemoryGatewayRepository();
  const { gateway, plainKey } = Gateway.create({ organizationId: crypto.randomUUID(), locationId: crypto.randomUUID(), name: 'GW', createdBy: 'u', now: new Date() });
  await repo.save(gateway);
  return { gateway, plainKey, adapter: new GatewayPressAdapter(repo) };
};

describe('GatewayPressAdapter', () => {
  it('autentica por hash y rechaza claves desconocidas', async () => {
    const { adapter, plainKey, gateway } = await setup();
    expect((await adapter.authenticate(plainKey)).id).toBe(gateway.id);
    await expect(adapter.authenticate('mvg_otra')).rejects.toBeInstanceOf(InvalidGatewayKeyError);
  });

  it('el tenant sale del gateway, no del mensaje', async () => {
    const { adapter, gateway } = await setup();
    const press = adapter.toPress(gateway, { device_code: 'B1', button_key: 'A', sent_at: '2026-10-19T10:00:00Z', location_id: 'evil' }, 'mqtt');
    expect(press).toMatchObject({ gatewayId: gateway.id, organizationId: gateway.organizationId, locationId: gateway.locationId, deviceCode: 'B1', buttonKey: 'A', callType: 'attention', transport: 'mqtt' });
    expect(press.sentAt).toEqual(new Date('2026-10-19T10:00:00Z'));
    expect(press.payload).not.toHaveProperty('location_id');
  });

  it('mensaje inválido -> ValidationError', async () => {
    const { adapter, gateway } = await setup();
    expect(() => adapter.toPress(gateway, { device_code: '' }, 'http')).toThrow(/Invalid press message/);
  });
});

describe('ButtonSignalTranslator', () => {
  it('usa el mapa del modelo y cae en attention por defecto', () => {
    const t = new ButtonSignalTranslator({ 'MODEL-X': { A: 'attention' } });
    expect(t.translate('MODEL-X', 'A')).toBe('attention');
    expect(t.translate('MODEL-X', 'Z')).toBe('attention');
    expect(t.translate(null, null)).toBe('attention');
  });
});
