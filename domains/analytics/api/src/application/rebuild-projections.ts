import type { AnalyticsEventSubscriber } from './analytics-event-subscriber.js';
import type { ProcessedEventStore, ServiceCallFactRepository, StockMovementFactRepository } from './ports/index.js';

export interface RebuildSummary {
  total: number;
  applied: number;
  duplicates: number;
  ignored: number;
}

/**
 * Vacía las tres tablas de analytics y reprocesa un historial de eventos (DATA-001 §5).
 * OPEN: ¿de dónde sale el historial sin leer tablas ajenas? DATA-001 §5 habla de reprocesar `outbox_events`
 * de hospitality y commerce, pero Analytics no puede leer sus esquemas (PLAN-001 Q-09). Aquí se recibe como iterable.
 * OPEN: ante un evento inválido se aborta (la proyección queda parcial); ¿omitir y reportar en su lugar?
 */
export class RebuildProjections {
  constructor(
    private readonly callFacts: ServiceCallFactRepository,
    private readonly stockFacts: StockMovementFactRepository,
    private readonly processed: ProcessedEventStore,
    private readonly subscriber: AnalyticsEventSubscriber,
  ) {}

  async execute(history: Iterable<unknown> | AsyncIterable<unknown>): Promise<RebuildSummary> {
    await Promise.all([this.callFacts.clear(), this.stockFacts.clear(), this.processed.clear()]);
    const summary: RebuildSummary = { total: 0, applied: 0, duplicates: 0, ignored: 0 };
    for await (const event of history) {
      summary.total++;
      const result = await this.subscriber.project(event);
      if (result === 'applied') summary.applied++;
      else if (result === 'duplicate') summary.duplicates++;
      else summary.ignored++;
    }
    return summary;
  }
}
