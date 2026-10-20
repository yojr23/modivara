import { defineEvent } from '@modivara/core-contracts';
import { z } from 'zod';
import { CALL_TYPES } from './enums.js';

const instant = z.iso.datetime({ offset: true });

/** Payloads v1 exactos de DATA-001 §6 (snake_case). */
export const serviceCallCreatedEventSchema = defineEvent(
  'hospitality.service_call.created',
  1,
  z.object({
    service_call_id: z.uuid(),
    table_id: z.uuid(),
    table_label: z.string(),
    zone_id: z.uuid().nullable(),
    zone_name: z.string().nullable(),
    call_type: z.enum(CALL_TYPES),
    created_at: instant,
  }),
);

export const serviceCallAcknowledgedEventSchema = defineEvent(
  'hospitality.service_call.acknowledged',
  1,
  z.object({
    service_call_id: z.uuid(),
    acknowledged_at: instant,
    acknowledged_by: z.uuid(),
    press_count: z.number().int().min(1),
  }),
);

export const serviceCallCompletedEventSchema = defineEvent(
  'hospitality.service_call.completed',
  1,
  z.object({
    service_call_id: z.uuid(),
    completed_at: instant,
    completed_by: z.uuid(),
    press_count: z.number().int().min(1),
  }),
);

export type ServiceCallCreatedEvent = z.infer<typeof serviceCallCreatedEventSchema>;
export type ServiceCallAcknowledgedEvent = z.infer<typeof serviceCallAcknowledgedEventSchema>;
export type ServiceCallCompletedEvent = z.infer<typeof serviceCallCompletedEventSchema>;
export type ServiceCallCreatedPayload = ServiceCallCreatedEvent['payload'];
export type ServiceCallAcknowledgedPayload = ServiceCallAcknowledgedEvent['payload'];
export type ServiceCallCompletedPayload = ServiceCallCompletedEvent['payload'];

export const HOSPITALITY_EVENT_TYPES = {
  serviceCallCreated: serviceCallCreatedEventSchema.shape.event_type.value,
  serviceCallAcknowledged: serviceCallAcknowledgedEventSchema.shape.event_type.value,
  serviceCallCompleted: serviceCallCompletedEventSchema.shape.event_type.value,
} as const;
