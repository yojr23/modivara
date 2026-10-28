import { buildEventRegistry, ProjectEvent, type Projector, type ProjectionTransaction } from '../../application/index.js';
import type { AnalyticsPrisma } from './client.js';
import { PrismaProcessedEventStore } from './prisma-processed-event-store.js';
import { PrismaServiceCallFactRepository } from './prisma-service-call-fact-repository.js';
import { PrismaStockMovementFactRepository } from './prisma-stock-movement-fact-repository.js';

/** TRUNCATE toma un lock exclusivo hasta el commit: las proyecciones en vivo esperan y luego deduplican contra `processed_events`. */
export class PrismaProjectionTransaction implements ProjectionTransaction {
  constructor(private readonly prisma: AnalyticsPrisma) {}

  run<T>(work: (projector: Projector) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const projectEvent = new ProjectEvent(
          buildEventRegistry(new PrismaServiceCallFactRepository(tx), new PrismaStockMovementFactRepository(tx)),
          new PrismaProcessedEventStore(tx),
        );
        return work({
          clear: async () => void (await tx.$executeRaw`TRUNCATE processed_events, service_call_facts, stock_movement_facts`),
          project: (event) => projectEvent.execute(event),
        });
      },
      { timeout: 3_600_000, maxWait: 60_000 }, // ponytail: una hora de tope; con historiales mayores, por lotes
    );
  }
}
