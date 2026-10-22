import { describe, expect, it } from 'vitest';
import { Gateway } from '../domain/devices/gateway.js';
import { InMemoryDeviceRepository, InMemoryGatewayRepository } from '../testing/in-memory.js';
import { Device } from '../domain/devices/device.js';
import { ButtonSignalTranslator } from './iot/key-map.js';
import { GatewayPressAdapter, InvalidGatewayKeyError } from './gateway-press.adapter.js';

const setup = async () => {
  const repo = new InMemoryGatewayRepository();
  const { gateway, plainKey } = Gateway.create({ organizationId: crypto.randomUUID(), locationId: crypto.randomUUID(), name: 'GW', createdBy: 'u', now: new Date() });
  await repo.save(gateway);
  const devices = new InMemoryDeviceRepository();
  return { gateway, plainKey, devices, adapter: new GatewayPressAdapter(repo, devices) };
};

describe('GatewayPressAdapter', () => {
  it('autentica por hash y rechaza claves desconocidas', async () => {
    const { adapter, plainKey, gateway } = await setup();
    expect((await adapter.authenticate(plainKey)).id).toBe(gateway.id);
    await expect(adapter.authenticate('mvg_otra')).rejects.toBeInstanceOf(InvalidGatewayKeyError);
  });

  it('el tenant sale del gateway, no del mensaje', async () => {
    const { adapter, gateway } = await setup();
    const press = await adapter.toPress(gateway, { device_code: 'B1', button_key: 'A', sent_at: '2026-10-19T10:00:00Z', location_id: 'evil' }, 'mqtt');
    expect(press).toMatchObject({ gatewayId: gateway.id, organizationId: gateway.organizationId, locationId: gateway.locationId, deviceCode: 'B1', buttonKey: 'A', callType: 'attention', transport: 'mqtt' });
    expect(press.sentAt).toEqual(new Date('2026-10-19T10:00:00Z'));
    expect(press.payload).not.toHaveProperty('location_id');
  });

  it('mensaje inválido -> ValidationError', async () => {
    const { adapter, gateway } = await setup();
    await expect(adapter.toPress(gateway, { device_code: '' }, 'http')).rejects.toThrow(/Invalid press message/);
  });

  it('la tecla se traduce según el modelo del dispositivo registrado', async () => {
    const { gateway, devices } = await setup();
    await devices.save(Device.create({ organizationId: gateway.organizationId, locationId: gateway.locationId, code: 'B1', model: 'MODEL-X', createdBy: 'u', now: new Date() }));
    const seen: Array<string | null> = [];
    const spy = new ButtonSignalTranslator({ 'MODEL-X': { A: 'attention' } });
    const original = spy.translate.bind(spy);
    spy.translate = (model, key) => (seen.push(model), original(model, key));
    const repo = new InMemoryGatewayRepository();
    const adapter = new GatewayPressAdapter(repo, devices, spy);
    expect((await adapter.toPress(gateway, { device_code: 'B1', button_key: 'A' }, 'http')).callType).toBe('attention');
    await adapter.toPress(gateway, { device_code: 'B1' }, 'http');
    expect(seen).toEqual(['MODEL-X', null]);
  });
});
