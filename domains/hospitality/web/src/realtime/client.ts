import { REALTIME_EVENTS as E, REALTIME_PATH, gatewaysStatusSchema, layoutPublishedSchema, realtimeSubscribeAckSchema, serviceCallSchema, type ServiceCallDto } from '@modivara/hospitality-contracts';
import type { QueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { layoutKeys } from '../layouts.js';
import { callsKeys, applyCallChange } from './cache.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';
export type GatewaysConnectivity = ReturnType<typeof gatewaysStatusSchema.parse>['connectivity'];

/** Subconjunto de `Socket` que usamos; las pruebas inyectan uno falso. */
export interface RealtimeSocket {
  on(event: string, fn: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(): unknown;
}
export type SocketFactory = () => RealtimeSocket;

/** Mismo origen; la cookie de sesión viaja sola (`withCredentials`), el JS no la lee. Reconexión automática de socket.io. */
export const defaultSocketFactory: SocketFactory = () =>
  io({ path: REALTIME_PATH, withCredentials: true }) as unknown as RealtimeSocket;

export type RealtimeState = { status: ConnectionStatus; gateways: GatewaysConnectivity | undefined };

/** Conexión de un local. Al (re)conectar y quedar suscrito, invalida las consultas del local: el REST es lo autoritativo (TECH-001 §7). */
export class RealtimeClient {
  private state: RealtimeState = { status: 'connecting', gateways: undefined };
  private listeners = new Set<() => void>();
  private socket: RealtimeSocket;
  private closed = false;
  private subscribedBefore = false;

  constructor(private readonly locationId: string, private readonly qc: QueryClient, factory: SocketFactory = defaultSocketFactory) {
    const s = (this.socket = factory());
    s.on('connect', () => this.subscribe());
    s.on('disconnect', () => this.set({ status: 'disconnected' }));
    s.on('connect_error', () => this.set({ status: 'disconnected' }));
    s.on(E.serviceCallChanged, (raw: unknown) => this.onCall(raw));
    s.on(E.gatewaysStatus, (raw: unknown) => this.onGateways(raw));
    s.on(E.layoutPublished, (raw: unknown) => this.onLayout(raw));
  }

  getState = (): RealtimeState => this.state;
  subscribeState = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  close(): void { this.closed = true; this.listeners.clear(); this.socket.disconnect(); }

  private set(patch: Partial<RealtimeState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  private subscribe() {
    this.set({ status: 'connecting' });
    this.socket.emit(E.subscribe, { location_id: this.locationId }, (ack: unknown) => {
      if (this.closed) return;
      const a = realtimeSubscribeAckSchema.safeParse(ack);
      // OPEN: ack `ok:false` (p. ej. sin permiso) se muestra como desconectado y no se reintenta solo.
      if (!a.success || !a.data.ok) return this.set({ status: 'disconnected' });
      this.set({ status: 'connected' });
      // Los eventos se pierden mientras no hay suscripción: tras re-suscribir se relee el estado autoritativo.
      if (this.subscribedBefore) {
        void this.qc.invalidateQueries({ queryKey: callsKeys.all(this.locationId) });
        void this.qc.invalidateQueries({ queryKey: layoutKeys.published(this.locationId) });
      }
      this.subscribedBefore = true;
    });
  }

  /** El servidor solo emite a la sala del local; además se descarta cualquier evento de otro local (defensa en profundidad). */
  private onCall(raw: unknown) {
    if (this.closed) return;
    const p = serviceCallSchema.safeParse(raw);
    if (p.success && p.data.location_id === this.locationId) this.apply(p.data);
  }
  private apply(call: ServiceCallDto) { applyCallChange(this.qc, this.locationId, call); }

  /** Plano publicado: los tableros abiertos lo releen por REST (no se aplica el aviso al caché). */
  private onLayout(raw: unknown) {
    const p = layoutPublishedSchema.safeParse(raw);
    if (!this.closed && p.success && p.data.location_id === this.locationId) void this.qc.invalidateQueries({ queryKey: layoutKeys.published(this.locationId) });
  }

  private onGateways(raw: unknown) {
    const p = gatewaysStatusSchema.safeParse(raw);
    if (p.success && p.data.location_id === this.locationId) this.set({ gateways: p.data.connectivity });
  }
}
