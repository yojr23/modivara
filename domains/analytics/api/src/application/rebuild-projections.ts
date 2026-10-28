import type { EventHistoryReader, IntegrationEvent } from '@modivara/core-contracts';
import type { ProjectionTransaction } from './ports/index.js';

export interface RebuildSummary {
  total: number;
  applied: number;
  duplicates: number;
  ignored: number;
}

/** Un evento inválido aborta la reconstrucción (la transacción se revierte y la proyección anterior queda intacta). */
export class RebuildAbortedError extends Error {
  constructor(readonly eventId: string, cause: unknown) {
    super(`Rebuild aborted at event ${eventId}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

const before = (a: IntegrationEvent, b: IntegrationEvent) =>
  a.occurred_at < b.occurred_at || (a.occurred_at === b.occurred_at && a.event_id < b.event_id);

/** Mezcla flujos ya ordenados por (occurred_at, id) en uno solo con el mismo orden, sin cargarlos enteros. */
async function* merge(streams: AsyncIterable<IntegrationEvent>[]): AsyncGenerator<IntegrationEvent> {
  const iterators = streams.map((s) => s[Symbol.asyncIterator]());
  const heads = await Promise.all(iterators.map((i) => i.next()));
  for (;;) {
    let best = -1;
    heads.forEach((h, i) => {
      if (!h!.done && (best < 0 || before(h!.value, (heads[best] as IteratorYieldResult<IntegrationEvent>).value))) best = i;
    });
    if (best < 0) return;
    yield (heads[best] as IteratorYieldResult<IntegrationEvent>).value;
    heads[best] = await iterators[best]!.next();
  }
}

/**
 * Vacía las tablas de analytics y reproceso el historial de los emisores (DATA-001 §5, Q-09) en una sola transacción:
 * los eventos en vivo esperan al commit y luego se deduplican por `processed_events`. El historial se mezcla por (occurred_at, id)
 * para que un `acknowledged` nunca se procese antes de su `created`.
 */
export class RebuildProjections {
  constructor(private readonly transaction: ProjectionTransaction) {}

  execute(readers: readonly EventHistoryReader[]): Promise<RebuildSummary> {
    return this.transaction.run(async (projector) => {
      await projector.clear();
      const summary: RebuildSummary = { total: 0, applied: 0, duplicates: 0, ignored: 0 };
      for await (const event of merge(readers.map((r) => r.read()))) {
        summary.total++;
        try {
          const result = await projector.project(event);
          if (result === 'applied') summary.applied++;
          else if (result === 'duplicate') summary.duplicates++;
          else summary.ignored++;
        } catch (e) {
          throw new RebuildAbortedError(event.event_id, e);
        }
      }
      return summary;
    });
  }
}
