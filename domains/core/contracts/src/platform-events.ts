import { z } from 'zod';
import { defineEvent } from './events.js';

/**
 * Contrato neutro de plataforma (MOD-10): acciones del superadmin que un dominio ejecuta y core vuelca en `core.audit_log`
 * con este mismo `action` (ADR-002 D3). Vive en core-contracts para que core-api no dependa de ningún dominio vertical.
 * Hoy solo lo emite hospitality (gateways y botones); el `event_type` conserva su nombre original (formato en el cable sin cambios).
 */
export const PLATFORM_ACTIONS = ['gateway.created', 'gateway.deactivated', 'device.created', 'device.assigned', 'device.unassigned'] as const;

export const platformActionRecordedEventSchema = defineEvent(
  'hospitality.platform_action.recorded',
  1,
  z.object({
    action: z.enum(PLATFORM_ACTIONS),
    actor_user_id: z.uuid(),
    target_type: z.enum(['gateway', 'device']),
    target_id: z.uuid(),
    /** Nunca claves ni hashes. */
    details: z.record(z.string(), z.unknown()),
  }),
);

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];
export type PlatformActionRecordedEvent = z.infer<typeof platformActionRecordedEventSchema>;
