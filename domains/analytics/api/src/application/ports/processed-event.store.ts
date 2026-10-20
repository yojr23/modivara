/** Deduplicación por `event_id` (entrega at-least-once, TECH-001 §9). */
export interface ProcessedEventStore {
  has(eventId: string): Promise<boolean>;
  add(eventId: string, eventType: string): Promise<void>;
  /** Solo para reconstrucción de proyecciones. */
  clear(): Promise<void>;
}
