import { describe, expect, it, vi } from 'vitest';
import { renderPage } from './page.ts';
import { GatewaySimulator, parseDevices } from './simulator.ts';
import { GATEWAY_KEY_HEADER, HttpTransport, mqttTopic, type GatewayTransport, type TransportName } from './transports.ts';

const fake = (name: TransportName): GatewayTransport => ({ name, sendPress: vi.fn(async () => {}), sendHeartbeat: vi.fn(async () => {}) });
const devices = parseDevices('btn-01:Mesa 1,btn-02');

describe('GatewaySimulator', () => {
  it('envía la pulsación por el canal activo y cambia de canal sin tocar el mensaje', async () => {
    const http = fake('http');
    const mqtt = fake('mqtt');
    const sim = new GatewaySimulator(devices, [http, mqtt], 'http');
    const now = new Date('2026-10-19T22:00:00Z');

    await sim.press('btn-01', now);
    sim.useTransport('mqtt');
    await sim.press('btn-01', now);

    const message = { device_code: 'btn-01', sent_at: '2026-10-19T22:00:00.000Z' };
    expect(http.sendPress).toHaveBeenCalledWith(message);
    expect(mqtt.sendPress).toHaveBeenCalledWith(message);
  });

  it('rechaza canales no configurados y dispositivos ajenos', () => {
    const sim = new GatewaySimulator(devices, [fake('http')], 'http');
    expect(() => sim.useTransport('mqtt')).toThrow(/MQTT/);
    expect(() => sim.press('btn-99')).toThrow(/desconocido/);
  });
});

describe('parseDevices', () => {
  it('usa 15 botones por defecto y respeta etiquetas', () => {
    expect(parseDevices(undefined)).toHaveLength(15);
    expect(devices).toEqual([{ code: 'btn-01', label: 'Mesa 1' }, { code: 'btn-02', label: 'btn-02' }]);
  });
});

describe('HttpTransport', () => {
  it('autentica con la clave del gateway y nunca envía el tenant', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    await new HttpTransport('http://api/api/v1/', 'k3y', fetchImpl as unknown as typeof fetch).sendPress({ device_code: 'btn-01' });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/api/v1/device-events');
    expect((init.headers as Record<string, string>)[GATEWAY_KEY_HEADER]).toBe('k3y');
    expect(JSON.parse(init.body as string)).toEqual({ device_code: 'btn-01' });
  });

  it('falla si la API rechaza', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    await expect(new HttpTransport('http://api', 'x', fetchImpl as unknown as typeof fetch).sendHeartbeat({})).rejects.toThrow('401');
  });
});

it('tópicos MQTT por gateway y página sin HTML inyectable', () => {
  expect(mqttTopic('gw-1', 'press')).toBe('modivara/gw/gw-1/press');
  expect(renderPage([{ code: 'a"b', label: '<script>' }], 'http')).not.toContain('<script>x');
  expect(renderPage([{ code: 'x', label: '<b>' }], 'http')).toContain('&#60;b&#62;');
});
