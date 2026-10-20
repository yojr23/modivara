import type { CoreAccessPort } from '@modivara/core-contracts';
import { Gateway } from '../domain/devices/gateway.js';
import { NotFoundError } from '../domain/errors.js';
import type { Clock, GatewayRepository } from './ports/index.js';
import { type ActorContext, assertLocation, type TenantContext } from './support.js';

export class CreateGateway {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly gateways: GatewayRepository,
    private readonly clock: Clock,
  ) {}

  /** `plainKey` se devuelve una sola vez; solo el hash SHA-256 queda guardado. */
  async execute(input: ActorContext & { name: string }): Promise<{ gateway: Gateway; plainKey: string }> {
    await assertLocation(this.core, input);
    const created = Gateway.create({ ...input, createdBy: input.actorId, now: this.clock.now() });
    await this.gateways.save(created.gateway);
    return created;
  }
}

export class RecordHeartbeat {
  constructor(
    private readonly gateways: GatewayRepository,
    private readonly clock: Clock,
  ) {}

  /** El adaptador ya autenticó al gateway; `gatewayId` y `locationId` vienen de esa autenticación. */
  async execute(input: { gatewayId: string; locationId: string }): Promise<void> {
    const gateway = await this.gateways.findById(input.gatewayId);
    if (!gateway?.isActive || gateway.locationId !== input.locationId) throw new NotFoundError('gateway');
    gateway.recordHeartbeat(this.clock.now());
    await this.gateways.save(gateway);
  }
}

export interface GatewayConnectivity {
  gatewayId: string;
  name: string;
  lastSeenAt: Date | null;
  connected: boolean;
}

export class GetConnectivity {
  constructor(
    private readonly gateways: GatewayRepository,
    private readonly clock: Clock,
  ) {}

  /** `anyDisconnected` alimenta el aviso "Botones desconectados" del tablero. */
  async execute(input: TenantContext): Promise<{ gateways: GatewayConnectivity[]; anyDisconnected: boolean }> {
    const now = this.clock.now();
    const gateways = (await this.gateways.listByLocation(input.locationId))
      .filter((g) => g.isActive)
      .map((g) => ({ gatewayId: g.id, name: g.name, lastSeenAt: g.lastSeenAt, connected: g.isConnected(now) }));
    return { gateways, anyDisconnected: gateways.some((g) => !g.connected) };
  }
}
