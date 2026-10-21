import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { GATEWAY_HEARTBEAT_INTERVAL_MS } from '@modivara/hospitality-contracts';
import { renderPage } from './page.ts';
import { GatewaySimulator, parseDevices, startHeartbeat } from './simulator.ts';
import { HttpTransport, MqttTransport, TRANSPORTS, type GatewayTransport, type TransportName } from './transports.ts';

// Simulador de gateway (TECH-001 §16.6). Proceso aparte: habla con la API solo por HTTP o MQTT, como un gateway real.
const env = process.env;
const required = (name: string) => {
  const value = env[name];
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
};

const transports: GatewayTransport[] = [new HttpTransport(required('SIM_API_URL'), required('SIM_GATEWAY_KEY'))];
if (env.MQTT_URL && env.SIM_GATEWAY_ID && env.SIM_MQTT_PASSWORD) {
  transports.push(new MqttTransport(env.MQTT_URL, env.SIM_GATEWAY_ID, env.SIM_MQTT_PASSWORD));
}
const sim = new GatewaySimulator(parseDevices(env.SIM_DEVICES), transports, (env.SIM_TRANSPORT as TransportName) ?? 'http');

startHeartbeat(sim, GATEWAY_HEARTBEAT_INTERVAL_MS, (e) => console.warn(`Señal de vida fallida (${sim.transport}): ${e.message}`));

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000) throw new Error('Cuerpo demasiado grande');
  }
  return JSON.parse(raw || '{}');
}

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

/** Bloquea POST entre sitios: JSON obligatorio (fuerza preflight) y mismo origen que el host. */
function isSameOriginJson(req: IncomingMessage): boolean {
  if (!req.headers['content-type']?.startsWith('application/json')) return false;
  const origin = req.headers.origin;
  return !origin || URL.parse(origin)?.host === req.headers.host;
}

// OPEN: al publicar la demo en un VPS, proteger /sim (p. ej. basic_auth en Caddy); hoy cualquiera con la URL puede pulsar.
createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && !isSameOriginJson(req)) return send(res, 403, { error: 'Origen no permitido' });
    if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(renderPage(sim.devices, sim.transport));
    }
    if (req.method === 'POST' && req.url === '/press') {
      const { device_code } = await readJson(req);
      await sim.press(String(device_code));
      return send(res, 202, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/transport') {
      const { transport } = await readJson(req);
      if (!TRANSPORTS.includes(transport as TransportName)) return send(res, 400, { error: 'Canal inválido' });
      sim.useTransport(transport as TransportName);
      return send(res, 200, { ok: true });
    }
    send(res, 404, { error: 'No encontrado' });
  } catch (e) {
    send(res, 502, { error: (e as Error).message });
  }
}).listen(Number(env.SIM_PORT ?? 4000), () => console.log(`button-sim escuchando en :${env.SIM_PORT ?? 4000} (canal ${sim.transport})`));
