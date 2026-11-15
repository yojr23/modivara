import { z } from 'zod';
import { defineEvent } from './events.js';
import { MODULES } from './identity.js';

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

const moduleChangePayload = z.object({
  module: z.enum(MODULES),
  organization_id: z.uuid(),
  location_id: z.uuid(),
  changed_by: z.uuid(),
});

/**
 * MOD-14/26: el superadmin habilitó o deshabilitó un módulo de un negocio. Uno por local activo del negocio en ese momento
 * (`location_id` del sobre = ese local; `aggregate_id` = negocio): el dominio inicializa ese local de forma idempotente, igual que con
 * `core.location.created`. Deshabilitar solo cambia el entitlement (los datos se conservan; la API responde 403 `module_disabled`).
 */
export const moduleEnabledEventSchema = defineEvent('core.module.enabled', 1, moduleChangePayload);
export const moduleDisabledEventSchema = defineEvent('core.module.disabled', 1, moduleChangePayload);
export type ModuleEnabledEvent = z.infer<typeof moduleEnabledEventSchema>;
