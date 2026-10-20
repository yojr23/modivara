import type { EventSubscriber } from './ports/index.js';
import type { ProjectEvent } from './project-event.js';
import type { ProjectionResult } from './support.js';

/** Suscriptor que el poller de outbox invoca con cada evento. */
export class AnalyticsEventSubscriber implements EventSubscriber {
  constructor(private readonly projectEvent: ProjectEvent) {}

  async handle(event: unknown): Promise<void> {
    await this.projectEvent.execute(event);
  }

  project(event: unknown): Promise<ProjectionResult> {
    return this.projectEvent.execute(event);
  }
}
