/** Deduplicación por `event_id` (entrega at-least-once, TECH-001 §9). */
export interface ProcessedEventStore {
  has(eventId: string): Promise<boolean>;
  add(eventId: string, eventType: string): Promise<void>;
  /**
   * Solo para reconstrucción. Vaciar y reprocesar debe ser atómico respecto a los eventos en vivo: el adaptador
   * lo ejecuta junto con el reproceso en una transacción. Ver `RebuildProjections`.
   */
  clear(): Promise<void>;
}
