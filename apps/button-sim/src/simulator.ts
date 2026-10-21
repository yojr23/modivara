import type { SimDevice } from './page.ts';
import type { GatewayTransport, TransportName } from './transports.ts';

/** Gateway simulado: elige el canal activo y envía pulsaciones y señales de vida por él. */
export class GatewaySimulator {
  readonly devices: readonly SimDevice[];
  readonly #transports: ReadonlyMap<TransportName, GatewayTransport>;
  #active: GatewayTransport;

  constructor(devices: readonly SimDevice[], transports: readonly GatewayTransport[], initial: TransportName) {
    if (devices.length === 0) throw new Error('El simulador necesita al menos un dispositivo');
    this.devices = devices;
    this.#transports = new Map(transports.map((t) => [t.name, t]));
    this.#active = this.#get(initial);
  }

  get transport(): TransportName {
    return this.#active.name;
  }

  useTransport(name: TransportName) {
    this.#active = this.#get(name);
  }

  press(deviceCode: string, now = new Date()) {
    if (!this.devices.some((d) => d.code === deviceCode)) throw new Error(`Dispositivo desconocido para el simulador: ${deviceCode}`);
    return this.#active.sendPress({ device_code: deviceCode, sent_at: now.toISOString() });
  }

  heartbeat(now = new Date()) {
    return this.#active.sendHeartbeat({ sent_at: now.toISOString() });
  }

  #get(name: TransportName) {
    const t = this.#transports.get(name);
    if (!t) throw new Error(`Canal ${name.toUpperCase()} no configurado`);
    return t;
  }
}

/**
 * "btn-01:Mesa 1,btn-02:Mesa 2" → dispositivos. Sin valor: btn-01…btn-15 (seed de demo, DATA-001 §7).
 * OPEN: formato real de los códigos de dispositivo; depende del hardware y del seed.
 */
export function parseDevices(spec: string | undefined): SimDevice[] {
  if (!spec?.trim()) {
    return Array.from({ length: 15 }, (_, i) => ({ code: `btn-${String(i + 1).padStart(2, '0')}`, label: `Botón ${i + 1}` }));
  }
  return spec.split(',').map((entry) => {
    const [code = '', label] = entry.split(':').map((s) => s.trim());
    if (!code) throw new Error(`SIM_DEVICES inválido: "${entry}"`);
    return { code, label: label || code };
  });
}

/** Señal de vida periódica (TECH-001 §16.5). Un fallo se informa y no detiene el ciclo. */
export function startHeartbeat(sim: GatewaySimulator, intervalMs: number, onError: (e: Error) => void) {
  return setInterval(() => sim.heartbeat().catch(onError), intervalMs);
}
