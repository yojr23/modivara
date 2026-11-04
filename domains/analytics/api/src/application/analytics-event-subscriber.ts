import type { EventSubscriber, ProjectionTransaction } from './ports/index.js';
import type { ProjectionResult } from './support.js';

/** Suscriptor que el poller de outbox invoca con cada evento; reclamar y aplicar van en una sola transacción. */
export class AnalyticsEventSubscriber implements EventSubscriber {
  constructor(private readonly transaction: ProjectionTransaction) {}

  async handle(event: unknown): Promise<void> {
    await this.project(event);
  }

  project(event: unknown): Promise<ProjectionResult> {
    return this.transaction.run((projector) => projector.project(event));
  }
}
