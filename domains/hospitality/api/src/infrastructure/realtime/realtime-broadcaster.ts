import { Logger } from '@nestjs/common';
import { type CoreAccessPort, type Permission, type RequestActor } from '@modivara/core-contracts';
import { REALTIME_EVENTS } from '@modivara/hospitality-contracts';
import type { DefaultEventsMap, RemoteSocket } from 'socket.io';
import type { CallViews } from '../../application/call-view.js';
import type { CallChange, GatewayHealthChange, GatewayHealthNotifier, LocationSettingsRepository, NotificationPort } from '../../application/ports/index.js';
import { canSeeCall } from '../../domain/service-calls/visibility.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import { locationRoom, type RealtimeGateway, type SocketData } from './realtime.gateway.js';

type Member = RemoteSocket<DefaultEventsMap, SocketData>;

/**
 * Adaptador Socket.IO de los avisos al tablero: `service_call.changed` (NotificationPort) y `gateways.status` (GatewayHealthNotifier).
 * Emite directo tras el commit (no espera al poller de outbox). Cada aviso se filtra por socket con los permisos VIGENTES del usuario
 * en ese local (`canSeeCall` para llamados) y revalida la sesión: quien cerró sesión o perdió el permiso deja de recibir, y su socket se cierra.
 * ponytail: una revalidación por token y aviso (1–2 consultas); con salas grandes, cachear unos segundos.
 */
export class RealtimeBroadcaster implements NotificationPort, GatewayHealthNotifier {
  private readonly logger = new Logger('Realtime');

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly core: CoreAccessPort,
    private readonly views: CallViews,
    private readonly settings: LocationSettingsRepository,
  ) {}

  async callChanged(_change: CallChange, call: ServiceCall): Promise<void> {
    const { callVisibility } = await this.settings.get(call);
    const dto = await this.views.one(call);
    await this.emitToLocation(call.locationId, REALTIME_EVENTS.serviceCallChanged, dto, (actor, permissions) =>
      canSeeCall({ actorUserId: actor.actorUserId, locationId: call.locationId, permissions }, call, callVisibility),
    );
  }

  async connectivityChanged(change: GatewayHealthChange): Promise<void> {
    const payload = { location_id: change.locationId, connectivity: change.connected ? 'all_connected' : 'some_disconnected' } as const;
    await this.emitToLocation(change.locationId, REALTIME_EVENTS.gatewaysStatus, payload, (_actor, permissions) => permissions.has('hospitality.devices.status' satisfies Permission));
  }

  private async emitToLocation(
    locationId: string,
    event: string,
    payload: unknown,
    allowed: (actor: RequestActor, permissions: ReadonlySet<Permission>) => boolean,
  ): Promise<void> {
    const server = this.gateway.server;
    if (!server) return; // sin adaptador de Socket.IO (p. ej. pruebas HTTP puras)
    const members = (await server.in(locationRoom(locationId)).fetchSockets()) as unknown as Member[];
    // Una revalidación por token: los sockets de un mismo usuario (varias pestañas) comparten sesión y permisos.
    const verdicts = new Map<string, Promise<{ actor: RequestActor; permissions: ReadonlySet<Permission> } | null>>();
    const verdictOf = (token: string) => {
      let v = verdicts.get(token);
      if (!v) {
        v = (async () => {
          const actor = await this.core.authenticateSession(token);
          const permissions = actor && (await this.core.permissionsAt(actor, locationId, 'hospitality'));
          return actor && permissions ? { actor, permissions } : null;
        })();
        verdicts.set(token, v);
      }
      return v;
    };
    await Promise.all(
      members.map(async (member) => {
        try {
          const verdict = await verdictOf(member.data.token);
          if (!verdict) return void member.disconnect(true); // sesión revocada o sin acceso al local
          if (allowed(verdict.actor, verdict.permissions)) member.emit(event, payload);
        } catch (e) {
          this.logger.error(`No se pudo avisar a un socket: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),
    );
  }
}
