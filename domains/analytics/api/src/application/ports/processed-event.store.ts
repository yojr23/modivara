import type { AnalyticsSource } from './projection-transaction.js';

/** Deduplicación por `event_id` (entrega at-least-once, TECH-001 §9). */
export interface ProcessedEventStore {
  has(eventId: string): Promise<boolean>;
  /** Reclama el evento; `false` si ya estaba (otra entrega lo reclamó o lo procesó). */
  add(eventId: string, eventType: string): Promise<boolean>;
  /**
   * Solo para reconstrucción: borra los eventos cuyo `event_type` empieza por `<fuente>.` de `sources`. Vaciar y reprocesar debe ser atómico respecto a los eventos en vivo: el adaptador
   * lo ejecuta junto con el reproceso en una transacción. Ver `RebuildProjections`.
   */
  clear(sources: readonly AnalyticsSource[]): Promise<void>;
}
