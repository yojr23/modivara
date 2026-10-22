import type { GatewayHealthNotifier, GatewayRepository } from './ports/index.js';

/**
 * Detecta transiciones de conectividad por local (TECH-001 §16.5): un local está desconectado si algún gateway activo
 * lleva más de `GATEWAY_DISCONNECTED_AFTER_MS` sin señal. Avisa una vez por transición, no en cada ciclo.
 * ponytail: el último estado vive en memoria; tras reiniciar la API la primera lectura es la base y no avisa, y con varias
 * instancias cada una avisaría. El tablero recupera el estado real por REST (`GetConnectivity`).
 */
export class DetectGatewayHealthChanges {
  private readonly disconnected = new Map<string, boolean>();

  constructor(
    private readonly gateways: GatewayRepository,
    private readonly notifier: GatewayHealthNotifier,
  ) {}

  async execute(): Promise<void> {
    const now = new Date();
    const byLocation = new Map<string, { organizationId: string; locationId: string; down: string[] }>();
    for (const g of await this.gateways.listActive()) {
      const key = `${g.organizationId}/${g.locationId}`;
      const entry = byLocation.get(key) ?? { organizationId: g.organizationId, locationId: g.locationId, down: [] };
      if (!g.isConnected(now)) entry.down.push(g.id);
      byLocation.set(key, entry);
    }
    for (const key of this.disconnected.keys()) if (!byLocation.has(key)) this.disconnected.delete(key);

    for (const [key, { organizationId, locationId, down }] of byLocation) {
      const isDown = down.length > 0;
      const before = this.disconnected.get(key);
      this.disconnected.set(key, isDown);
      // OPEN: la primera observación de un local es solo la base (no avisa); ¿avisar «desconectado» al arrancar si ya lo está?
      if (before === undefined || before === isDown) continue;
      await this.notifier.connectivityChanged({ organizationId, locationId, connected: !isDown, disconnectedGatewayIds: down });
    }
  }
}
