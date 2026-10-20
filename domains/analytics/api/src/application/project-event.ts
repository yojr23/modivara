import type { EventRegistry } from './event-registry.js';
import type { ProcessedEventStore } from './ports/index.js';
import { parseEvent, readEventType, type ProjectionResult } from './support.js';

/**
 * Proyecta un evento de hospitality o commerce según el registro. Si `apply` lanza (p. ej. `EventOutOfOrderError`)
 * el evento no se marca como procesado y el poller lo reintenta; los `apply` son idempotentes, así que aplicar y
 * marcar en pasos separados es seguro.
 */
export class ProjectEvent {
  constructor(
    private readonly registry: EventRegistry,
    private readonly processed: ProcessedEventStore,
  ) {}

  async execute(event: unknown): Promise<ProjectionResult> {
    const eventType = readEventType(event);
    const handler = this.registry.get(eventType);
    if (!handler) return 'ignored';
    const parsed = parseEvent(handler.schema, event); // única validación Zod del evento
    if (await this.processed.has(parsed.event_id)) return 'duplicate';
    await handler.apply(parsed);
    await this.processed.add(parsed.event_id, eventType);
    return 'applied';
  }
}
