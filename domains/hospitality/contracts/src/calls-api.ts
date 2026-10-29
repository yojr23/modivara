import { z } from 'zod';
import { CALL_ACTIONS, CALL_STATUSES, CALL_TYPES } from './enums.js';
import { CONNECTIVITY_STATUSES } from './config-api.js';

/** API de llamados bajo `/api/v1` (PLAN-001 F3-08). Toda consulta pasa por `canSeeCall` en el servidor. */
export const CALLS_API_PATHS = {
  serviceCalls: '/locations/:locationId/service-calls',
  acknowledge: '/locations/:locationId/service-calls/:callId/acknowledge',
  serviceCall: '/locations/:locationId/service-calls/:callId',
  complete: '/locations/:locationId/service-calls/:callId/complete',
} as const;

export const serviceCallSchema = z.object({
  id: z.uuid(),
  /** Permite al cliente descartar eventos de otro local además del filtrado por sala del servidor. */
  location_id: z.uuid(),
  table_id: z.uuid(),
  /** "Terraza · Mesa 3" o la etiqueta sola. */
  table_display_name: z.string(),
  call_type: z.enum(CALL_TYPES),
  status: z.enum(CALL_STATUSES),
  press_count: z.number().int().min(1),
  created_at: z.iso.datetime({ offset: true }),
  last_press_at: z.iso.datetime({ offset: true }),
  acknowledged_at: z.iso.datetime({ offset: true }).nullable(),
  acknowledged_by: z.uuid().nullable(),
  /** Nombre visible resuelto por core; null si no hay actor o ya no se puede resolver. */
  acknowledged_by_name: z.string().nullable(),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  completed_by: z.uuid().nullable(),
  completed_by_name: z.string().nullable(),
});
export type ServiceCallDto = z.infer<typeof serviceCallSchema>;

/** `GET service-calls/:callId`: el llamado más su historia, por `occurred_at`. `actor_*` null cuando el origen es un botón. */
export const callTransitionSchema = z.object({
  action: z.enum(CALL_ACTIONS),
  from_status: z.enum(CALL_STATUSES).nullable(),
  to_status: z.enum(CALL_STATUSES),
  occurred_at: z.iso.datetime({ offset: true }),
  actor_user_id: z.uuid().nullable(),
  actor_name: z.string().nullable(),
  device_event_id: z.uuid().nullable(),
});
export const serviceCallDetailSchema = serviceCallSchema.extend({ transitions: z.array(callTransitionSchema) });
export type CallTransitionDto = z.infer<typeof callTransitionSchema>;
export type ServiceCallDetailDto = z.infer<typeof serviceCallDetailSchema>;

/** Reconocer y finalizar responden con el llamado actualizado. */
export const callActionResponseSchema = serviceCallSchema;
/** 409 al reconocer/finalizar: otro usuario ya cambió el estado; `current` es el estado vigente (DATA-001 §3). */
export const callConflictSchema = z.object({ code: z.string(), message: z.string().optional(), current: serviceCallSchema });

/** `GET service-calls`: `status=active` para el tablero; historial con filtros y cursor. */
export const listServiceCallsQuerySchema = z.object({
  status: z.enum(['active', 'all', ...CALL_STATUSES]).default('active'),
  table_id: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const serviceCallPageSchema = z.object({ items: z.array(serviceCallSchema), next_cursor: z.string().nullable() });
export type ServiceCallPage = z.infer<typeof serviceCallPageSchema>;

/**
 * Tiempo real (Socket.IO, F3-10). Mismo origen y misma cookie de sesión que la API; las salas las decide el servidor.
 * El cliente pide suscribirse a un local; el servidor verifica `hospitality.calls.read` en ese local antes de unirlo.
 */
export const REALTIME_PATH = '/api/v1/realtime';
export const REALTIME_EVENTS = {
  subscribe: 'location.subscribe',
  serviceCallChanged: 'service_call.changed',
  gatewaysStatus: 'gateways.status',
  layoutPublished: 'layout.published',
} as const;
export const realtimeSubscribeSchema = z.object({ location_id: z.uuid() });
export const realtimeSubscribeAckSchema = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), code: z.string() })]);
export const gatewaysStatusSchema = z.object({ location_id: z.uuid(), connectivity: z.enum(CONNECTIVITY_STATUSES) });
