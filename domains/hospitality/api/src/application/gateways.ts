import type { CoreAccessPort } from '@modivara/core-contracts';
import { Gateway } from '../domain/devices/gateway.js';
import { NotFoundError } from '../domain/errors.js';
import type { DeviceAssignmentRepository, DiningTableRepository, GatewayRepository } from './ports/index.js';
import { type ActorContext, requireActiveLocation, owned, scopeOf, type TenantContext } from './support.js';

export class CreateGateway {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly gateways: GatewayRepository,
  ) {}

  /** `plainKey` se devuelve una sola vez; solo el hash SHA-256 queda guardado. */
  async execute(input: ActorContext & { name: string }): Promise<{ gateway: Gateway; plainKey: string }> {
    await requireActiveLocation(this.core, input);
    const created = Gateway.create({ ...input, createdBy: input.actorUserId, now: new Date() });
    await this.gateways.save(created.gateway);
    return created;
  }
}

export class RecordHeartbeat {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly gateways: GatewayRepository,
  ) {}

  /** El adaptador ya autenticó al gateway; `gatewayId` y `locationId` vienen de esa autenticación. */
  async execute(input: TenantContext & { gatewayId: string }): Promise<void> {
    // OPEN: sin el módulo hospitality el heartbeat se ignora sin error (no marca conectado); ¿debe responder distinto?
    if (!(await this.core.isModuleEnabled(input.organizationId, 'hospitality'))) return;
    const gateway = owned(await this.gateways.findById({ ...scopeOf(input), id: input.gatewayId }), input, 'gateway');
    if (!gateway.isActive) throw new NotFoundError('gateway');
    gateway.recordHeartbeat(new Date());
    await this.gateways.save(gateway);
  }
}

export interface GatewayConnectivity {
  gatewayId: string;
  name: string;
  lastSeenAt: Date | null;
  connected: boolean;
}

export type ConnectivityStatus = 'no_gateways' | 'all_connected' | 'some_disconnected';

export class GetConnectivity {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly gateways: GatewayRepository,
  ) {}

  /**
   * `some_disconnected` alimenta el aviso "Botones desconectados" del tablero. Sin gateways no hay nada que
   * vigilar: se informa `no_gateways` en vez de fingir que todo está conectado.
   */
  async execute(input: TenantContext): Promise<{ gateways: GatewayConnectivity[]; status: ConnectivityStatus }> {
    await requireActiveLocation(this.core, input);
    const now = new Date();
    const gateways = (await this.gateways.listByLocation(scopeOf(input)))
      .filter((g) => g.isActive)
      .map((g) => ({ gatewayId: g.id, name: g.name, lastSeenAt: g.lastSeenAt, connected: g.isConnected(now) }));
    const status = gateways.length === 0 ? 'no_gateways' : gateways.some((g) => !g.connected) ? 'some_disconnected' : 'all_connected';
    return { gateways, status };
  }
}

export interface DeviceStatus {
  connectivity: ConnectivityStatus;
  tables: Array<{ tableId: string; hasButton: boolean }>;
}

/** Lo que ven admin y staff: ¿cada mesa tiene botón? y ¿hay gateways desconectados? Nada técnico (DATA-001 §2 `hospitality.devices.status`). */
export class GetDeviceStatus {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly tables: DiningTableRepository,
    private readonly assignments: DeviceAssignmentRepository,
    private readonly connectivity: GetConnectivity,
  ) {}

  async execute(input: TenantContext): Promise<DeviceStatus> {
    await requireActiveLocation(this.core, input);
    const withButton = new Set((await this.assignments.listActiveByLocation(scopeOf(input))).map((a) => a.tableId));
    const tables = (await this.tables.listByLocation(scopeOf(input)))
      .filter((t) => t.isActive)
      .map((t) => ({ tableId: t.id, hasButton: withButton.has(t.id) }));
    return { connectivity: (await this.connectivity.execute(input)).status, tables };
  }
}
