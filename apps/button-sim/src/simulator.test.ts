import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GATEWAY_HEARTBEAT_INTERVAL_MS } from '@modivara/hospitality-contracts';
import type { MqttClient } from 'mqtt';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderPage } from './page.ts';
import { GatewaySimulator, parseDevices, startHeartbeat } from './simulator.ts';
import { GATEWAY_KEY_HEADER, HttpTransport, MqttTransport, mqttTopic, type GatewayTransport, type TransportName } from './transports.ts';

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

describe('HttpTransport contra un servidor HTTP real', () => {
  const requests: { url?: string; method?: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      requests.push({ url: req.url, method: req.method, headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(202).end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  afterAll(() => new Promise((ok) => server.close(ok)));

  it('cada pulsación y señal de vida llegan con ruta, método, headers y cuerpo del contrato', async () => {
    const sim = new GatewaySimulator(devices, [new HttpTransport(base, 'k3y')], 'http');
    await sim.press('btn-01', new Date('2026-10-19T22:00:00Z'));
    await sim.heartbeat(new Date('2026-10-19T22:00:30Z'));

    const [press, beat] = requests;
    expect(press).toMatchObject({ url: '/api/v1/device-events', method: 'POST', body: { device_code: 'btn-01', sent_at: '2026-10-19T22:00:00.000Z' } });
    expect(beat).toMatchObject({ url: '/api/v1/gateways/heartbeat', method: 'POST', body: { sent_at: '2026-10-19T22:00:30.000Z' } });
    for (const r of requests) {
      expect(r.headers[GATEWAY_KEY_HEADER]).toBe('k3y');
      expect(r.headers['content-type']).toBe('application/json');
    }
  });
});

describe('señal de vida', () => {
  it('sale cada 30 s por el canal activo y un fallo no detiene el ciclo', async () => {
    vi.useFakeTimers();
    try {
      const http = fake('http');
      vi.mocked(http.sendHeartbeat).mockRejectedValueOnce(new Error('caído'));
      const onError = vi.fn();
      const timer = startHeartbeat(new GatewaySimulator(devices, [http], 'http'), GATEWAY_HEARTBEAT_INTERVAL_MS, onError);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(http.sendHeartbeat).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(http.sendHeartbeat).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(http.sendHeartbeat).toHaveBeenCalledTimes(3);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MqttTransport con cliente inyectado', () => {
  const setup = (connected = true) => {
    const publishAsync = vi.fn(async () => undefined);
    const connectImpl = vi.fn(() => ({ connected, publishAsync }) as unknown as MqttClient);
    const transport = new MqttTransport('mqtt://broker:1883', 'gw-1', 'pw', connectImpl);
    return { publishAsync, connectImpl, transport };
  };

  it('se conecta con el id del gateway como usuario', () => {
    const { connectImpl } = setup();
    expect(connectImpl).toHaveBeenCalledWith('mqtt://broker:1883', expect.objectContaining({ username: 'gw-1', password: 'pw' }));
  });

  it('publica pulsación y señal de vida en el tópico del gateway con QoS 1 y el JSON del contrato', async () => {
    const { publishAsync, transport } = setup();
    const sim = new GatewaySimulator(devices, [transport], 'mqtt');
    await sim.press('btn-02', new Date('2026-10-19T22:00:00Z'));
    await sim.heartbeat(new Date('2026-10-19T22:00:30Z'));

    expect(publishAsync).toHaveBeenNthCalledWith(1, 'modivara/gw/gw-1/press', '{"device_code":"btn-02","sent_at":"2026-10-19T22:00:00.000Z"}', { qos: 1 });
    expect(publishAsync).toHaveBeenNthCalledWith(2, 'modivara/gw/gw-1/heartbeat', '{"sent_at":"2026-10-19T22:00:30.000Z"}', { qos: 1 });
  });

  it('falla sin publicar si no hay conexión con el broker', async () => {
    const { publishAsync, transport } = setup(false);
    await expect(transport.sendPress({ device_code: 'btn-01' })).rejects.toThrow(/broker/);
    expect(publishAsync).not.toHaveBeenCalled();
  });
});
