import type { DeviceEvent } from '../../domain/devices/device-event.js';
import type { ServiceCall } from '../../domain/service-calls/service-call.js';
import type { Scope } from './repositories.js';

/**
 * Operaciones atómicas dentro de la transacción de una pulsación (DATA-001 §3). Solo las que el flujo necesita:
 * no es un UnitOfWork genérico ni expone repositorios.
 */
export interface ButtonPressTx {
  /** Última pulsación contada (call_created/repeat_press) de la misma señal: botón + tecla. */
  findLastPress(query: Scope & { deviceId: string; buttonKey: string | null }): Promise<DeviceEvent | null>;
  /**
   * Equivale a `INSERT … ON CONFLICT (mesa, tipo activo) DO UPDATE SET press_count = press_count + 1`.
   * Si no hay llamado activo para la mesa y tipo, guarda `candidate` junto con su transición y su evento de outbox
   * (`pullTransitions()`/`pullEvents()`) y devuelve `created: true`; si lo hay, suma una pulsación y no guarda el candidato.
   */
  upsertActiveCall(candidate: ServiceCall, now: Date): Promise<{ call: ServiceCall; created: boolean }>;
  /** Todo resultado se registra, dentro de la misma transacción que el llamado. */
  saveDeviceEvent(event: DeviceEvent): Promise<void>;
}

export interface ButtonPressStore {
  /**
   * Abre una transacción que bloquea el dispositivo (serializa sus pulsaciones), ejecuta `work` y confirma;
   * si `work` lanza, deshace todo. La decisión (debounce, crear o repetir) es del caso de uso, no del adaptador.
   */
  withDeviceLock<T>(deviceId: string, work: (tx: ButtonPressTx) => Promise<T>): Promise<T>;
  /** Para señales que no llegan a un dispositivo operable (no registrado, local inactivo, sin mesa): solo se registran. */
  saveDeviceEvent(event: DeviceEvent): Promise<void>;
}
