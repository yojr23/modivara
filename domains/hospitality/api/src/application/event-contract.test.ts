import { describe, expect, it } from 'vitest';
import { serviceCallAcknowledgedEventSchema, serviceCallCompletedEventSchema, serviceCallCreatedEventSchema } from '@modivara/hospitality-contracts';
import { ServiceCall } from '../domain/service-calls/service-call.js';
import { toEventEnvelope } from '@modivara/core-contracts';

const uid = () => crypto.randomUUID();

// La validación Zod del contrato vive fuera de domain/ (TECH-001 §5).
describe('eventos del agregado vs contrato publicado', () => {
  it('created, acknowledged y completed son válidos', () => {
    const c = ServiceCall.create({
      organizationId: uid(), locationId: uid(),
      table: { id: uid(), label: '5', zoneId: uid(), zoneName: 'Terraza' },
      callType: 'attention', deviceEventId: uid(), correlationId: uid(), now: new Date('2026-10-19T10:00:00Z'),
    });
    expect(serviceCallCreatedEventSchema.safeParse(toEventEnvelope(c.pullEvents()[0]!)).success).toBe(true);
    c.acknowledge(uid(), new Date('2026-10-19T10:00:01Z'));
    c.complete(uid(), new Date('2026-10-19T10:00:02Z'));
    const [ack, done] = c.pullEvents();
    expect(serviceCallAcknowledgedEventSchema.safeParse(toEventEnvelope(ack!)).success).toBe(true);
    expect(serviceCallCompletedEventSchema.safeParse(toEventEnvelope(done!)).success).toBe(true);
  });
});
