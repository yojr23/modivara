import type { NotificationPort } from '../application/ports/index.js';

/**
 * OPEN: aún no hay adaptador Socket.IO (aviso en tiempo real al tablero). Mientras tanto el puerto se liga a este
 * no-op: el tablero se actualiza al refrescar. Reemplazar el binding NOTIFICATIONS en `HospitalityModule` cuando exista.
 */
export class NoopNotificationPort implements NotificationPort {
  async callChanged(): Promise<void> {}
}
