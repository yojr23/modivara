import type { ProjectCommerceEvent } from './project-commerce-event.js';
import type { ProjectHospitalityEvent } from './project-hospitality-event.js';
import type { EventSubscriber } from './ports/index.js';
import { readEnvelope, type ProjectionResult } from './support.js';

/** Suscriptor que el poller de outbox invoca con cada evento; enruta por dominio emisor. */
export class AnalyticsEventSubscriber implements EventSubscriber {
  constructor(
    private readonly hospitality: ProjectHospitalityEvent,
    private readonly commerce: ProjectCommerceEvent,
  ) {}

  async handle(event: unknown): Promise<void> {
    await this.project(event);
  }

  async project(event: unknown): Promise<ProjectionResult> {
    const { eventType } = readEnvelope(event);
    if (eventType.startsWith('hospitality.')) return this.hospitality.execute(event);
    if (eventType.startsWith('commerce.')) return this.commerce.execute(event);
    return 'ignored';
  }
}
