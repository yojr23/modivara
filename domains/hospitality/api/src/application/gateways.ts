import type { CoreAccessPort } from '@modivara/core-contracts';
import { Gateway } from '../domain/devices/gateway.js';
import { NotFoundError } from '../domain/errors.js';
import type { GatewayRepository } from './ports/index.js';
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
    private readonly gateways: GatewayRepository,
  ) {}

  /** El adaptador ya autenticó al gateway; `gatewayId` y `locationId` vienen de esa autenticación. */
  async execute(input: TenantContext & { gatewayId: string }): Promise<void> {
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

export class GetConnectivity {
  constructor(
    private readonly core: CoreAccessPort,
    private readonly gateways: GatewayRepository,
  ) {}

  /** `anyDisconnected` alimenta el aviso "Botones desconectados" del tablero. */
  async execute(input: TenantContext): Promise<{ gateways: GatewayConnectivity[]; anyDisconnected: boolean }> {
    await requireActiveLocation(this.core, input);
    const now = new Date();
    const gateways = (await this.gateways.listByLocation(scopeOf(input)))
      .filter((g) => g.isActive)
      .map((g) => ({ gatewayId: g.id, name: g.name, lastSeenAt: g.lastSeenAt, connected: g.isConnected(now) }));
    return { gateways, anyDisconnected: gateways.some((g) => !g.connected) };
  }
}
