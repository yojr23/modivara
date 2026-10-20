import {
  serviceCallAcknowledgedEventSchema,
  serviceCallCompletedEventSchema,
  serviceCallCreatedEventSchema,
} from '@modivara/hospitality-contracts';
import { ServiceCallFact } from '../domain/index.js';
import type { ProcessedEventStore, ServiceCallFactRepository } from './ports/index.js';
import { parseEvent, readEnvelope, type ProjectionResult } from './support.js';

/**
 * Proyecta eventos de llamados. Cada aplicación es idempotente y conmutativa, así que aplicar y
 * marcar como procesado en pasos separados es seguro: un reintento tras un fallo no corrompe el fact.
 */
export class ProjectHospitalityEvent {
  constructor(
    private readonly facts: ServiceCallFactRepository,
    private readonly processed: ProcessedEventStore,
  ) {}

  async execute(event: unknown): Promise<ProjectionResult> {
    const { eventId, eventType } = readEnvelope(event);
    if (!eventType.startsWith('hospitality.service_call.')) return 'ignored';
    if (await this.processed.has(eventId)) return 'duplicate';

    switch (eventType) {
      case 'hospitality.service_call.created': {
        const e = parseEvent(serviceCallCreatedEventSchema, event);
        await this.update(e, e.payload.service_call_id, (f) => f.applyCreated(e.payload));
        break;
      }
      case 'hospitality.service_call.acknowledged': {
        const e = parseEvent(serviceCallAcknowledgedEventSchema, event);
        await this.update(e, e.payload.service_call_id, (f) => f.applyAcknowledged(e.payload));
        break;
      }
      case 'hospitality.service_call.completed': {
        const e = parseEvent(serviceCallCompletedEventSchema, event);
        await this.update(e, e.payload.service_call_id, (f) => f.applyCompleted(e.payload));
        break;
      }
      default:
        return 'ignored';
    }
    await this.processed.add(eventId, eventType);
    return 'applied';
  }

  private async update(
    e: { organization_id: string; location_id: string },
    serviceCallId: string,
    apply: (fact: ServiceCallFact) => void,
  ): Promise<void> {
    // Si acknowledged/completed llega antes que created, se crea un fact parcial que `created` completa después.
    const fact =
      (await this.facts.findById(serviceCallId)) ??
      ServiceCallFact.create({ serviceCallId, organizationId: e.organization_id, locationId: e.location_id });
    fact.assertTenant(e.organization_id, e.location_id);
    apply(fact);
    await this.facts.save(fact);
  }
}
