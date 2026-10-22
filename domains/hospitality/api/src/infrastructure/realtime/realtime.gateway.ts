import { Inject, Logger } from '@nestjs/common';
import { type OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { parse } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { CORE_ACCESS_PORT, type CoreAccessPort, type RequestActor, SESSION_COOKIE } from '@modivara/core-contracts';
import { REALTIME_EVENTS, REALTIME_PATH, realtimeSubscribeSchema, type realtimeSubscribeAckSchema } from '@modivara/hospitality-contracts';

type SubscribeAck = ReturnType<typeof realtimeSubscribeAckSchema.parse>;

/** Lo que el handshake deja en el socket. El token se conserva para revalidar la sesión al emitir (logout, desactivación). */
export interface SocketData {
  actor: RequestActor;
  token: string;
}

/** Sala del servidor de un local: el cliente nunca elige el nombre de la sala (TECH-001 §9). */
export const locationRoom = (locationId: string): string => `loc:${locationId}`;

/** ¿El `Origin` del navegador es el mismo host? Sin `Origin` (clientes que no son navegador) se deja pasar, igual que `OriginGuard` de core. */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false; // 'null' u otro valor no válido
  }
}

/**
 * Socket.IO en `REALTIME_PATH` (TECH-001 §9, §7). Autentica en el handshake con la misma cookie de sesión que la API HTTP, rechaza
 * orígenes ajenos y solo une a la sala de un local tras verificar `hospitality.calls.read` allí. Delgado: las reglas viven en core.
 */
@WebSocketGateway({ path: REALTIME_PATH, serveClient: false })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger('Realtime');
  @WebSocketServer() server!: Server;

  constructor(@Inject(CORE_ACCESS_PORT) private readonly core: CoreAccessPort) {}

  afterInit(server: Server): void {
    server.on('connection', (socket) => this.onConnection(socket));
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (e: unknown) => next(e instanceof Error ? e : new Error('unauthorized')),
      );
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    const { headers } = socket.handshake;
    if (!sameOrigin(headers.origin, headers.host)) throw new Error('forbidden_origin');
    const token = parse(headers.cookie ?? '')[SESSION_COOKIE];
    const actor = token ? await this.core.authenticateSession(token) : null;
    if (!token || !actor) throw new Error('unauthorized');
    socket.data = { actor, token } satisfies SocketData;
  }

  /**
   * Se registra a mano (no con `@SubscribeMessage`): los guards globales de core (sesión por cookie HTTP, Origin) también se aplican a los
   * manejadores de gateways de Nest y no entienden sockets; aquí la autenticación ya ocurrió en el handshake.
   */
  private onConnection(socket: Socket): void {
    socket.on(REALTIME_EVENTS.subscribe, (body: unknown, ack?: unknown) => {
      void this.subscribe(socket, body).then((result) => typeof ack === 'function' && ack(result));
    });
  }

  private async subscribe(socket: Socket, body: unknown): Promise<SubscribeAck> {
    const parsed = realtimeSubscribeSchema.safeParse(body);
    if (!parsed.success) return { ok: false, code: 'validation' };
    const { location_id: locationId } = parsed.data;
    try {
      const permissions = await this.core.permissionsAt((socket.data as SocketData).actor, locationId, 'hospitality');
      // Local ajeno, inexistente o sin el módulo: indistinguibles (igual que HTTP, que responde 404/403 sin revelar).
      if (!permissions) return { ok: false, code: 'not_found' };
      if (!permissions.has('hospitality.calls.read')) return { ok: false, code: 'permission_denied' };
      await socket.join(locationRoom(locationId));
      return { ok: true };
    } catch (e) {
      this.logger.error(`Falló la suscripción: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, code: 'internal' };
    }
  }
}
