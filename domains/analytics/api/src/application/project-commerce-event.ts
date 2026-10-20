import { stockAdjustedV1, stockIssuedV1, stockReceivedV1, type MovementDirection, type StockEventPayload } from '@modivara/commerce-contracts';
import { StockMovementFact } from '../domain/index.js';
import type { ProcessedEventStore, StockMovementFactRepository } from './ports/index.js';
import { parseEvent, readEnvelope, type Parser, type ProjectionResult } from './support.js';

interface StockEnvelope {
  organization_id: string;
  location_id: string;
  payload: StockEventPayload;
}
type StockSchema = Parser<StockEnvelope>;

const STOCK_EVENTS: Record<string, { schema: StockSchema; direction: MovementDirection }> = {
  'commerce.stock.received': { schema: stockReceivedV1, direction: 'in' },
  'commerce.stock.issued': { schema: stockIssuedV1, direction: 'out' },
  'commerce.stock.adjusted': { schema: stockAdjustedV1, direction: 'adjust' },
};

/** Proyecta movimientos de inventario. Upsert por `movement_id`: reaplicar el mismo evento no cambia nada. */
export class ProjectCommerceEvent {
  constructor(
    private readonly facts: StockMovementFactRepository,
    private readonly processed: ProcessedEventStore,
  ) {}

  async execute(event: unknown): Promise<ProjectionResult> {
    const { eventId, eventType } = readEnvelope(event);
    const handler = STOCK_EVENTS[eventType];
    if (!handler) return 'ignored';
    if (await this.processed.has(eventId)) return 'duplicate';

    const e = parseEvent(handler.schema, event);
    await this.facts.save(
      StockMovementFact.create({
        organizationId: e.organization_id,
        locationId: e.location_id,
        direction: handler.direction,
        payload: e.payload,
      }),
    );
    await this.processed.add(eventId, eventType);
    return 'applied';
  }
}
