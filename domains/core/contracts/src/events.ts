import { z } from 'zod';

/**
 * Sobre común de los eventos de integración (TECH-001 §7, DATA-001 §6).
 * Cada dominio emisor define sus eventos en su propio contracts con `defineEvent`.
 */
export const eventEnvelopeSchema = z.object({
  event_id: z.uuid(),
  event_type: z.string().min(1),
  event_version: z.number().int().positive(),
  occurred_at: z.iso.datetime({ offset: true }),
  organization_id: z.uuid(),
  location_id: z.uuid(),
  aggregate_id: z.uuid(),
  correlation_id: z.uuid(),
  causation_id: z.uuid().nullable(),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Fábrica del esquema de un evento versionado: sobre + tipo literal + payload propio. */
export function defineEvent<const T extends string, const V extends number, P extends z.ZodType>(
  type: T,
  version: V,
  payload: P,
) {
  return eventEnvelopeSchema.extend({
    event_type: z.literal(type),
    event_version: z.literal(version),
    payload,
  });
}
