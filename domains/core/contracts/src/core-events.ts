import { z } from 'zod';
import { defineEvent } from './events.js';

/**
 * Único evento de core (Q-05): nace con cada local nuevo. Commerce y hospitality siembran lo suyo al recibirlo
 * (los motivos por negocio, de forma idempotente, con el primer local). `aggregate_id` = `location_id`.
 */
// OPEN: los locales creados antes de este evento no tienen uno en el outbox (sin backfill); los seeds llaman a los mismos casos de uso.
export const locationCreatedEventSchema = defineEvent(
  'core.location.created',
  1,
  z.object({
    location_id: z.uuid(),
    organization_id: z.uuid(),
    organization_slug: z.string(),
    location_name: z.string(),
    timezone: z.string(),
    created_by: z.uuid(),
  }),
);
export type LocationCreatedEvent = z.infer<typeof locationCreatedEventSchema>;
