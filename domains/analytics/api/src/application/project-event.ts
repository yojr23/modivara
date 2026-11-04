import type { EventRegistry } from './event-registry.js';
import type { ProcessedEventStore } from './ports/index.js';
import { parseEvent, readEventType, type ProjectionResult } from './support.js';

/**
 * Proyecta un evento de hospitality o commerce según el registro. Primero reclama el `event_id` (INSERT ... ON CONFLICT
 * DO NOTHING) y luego aplica: dos entregas concurrentes no pueden aplicar ambas, y si `apply` lanza (p. ej.
 * `EventOutOfOrderError`) la transacción del llamador revierte también el reclamo y el poller reintenta.
 * Debe ejecutarse dentro de `ProjectionTransaction.run`; fuera de una transacción el reclamo no se revierte.
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
    if (!(await this.processed.add(parsed.event_id, eventType))) return 'duplicate';
    await handler.apply(parsed);
    return 'applied';
  }
}
