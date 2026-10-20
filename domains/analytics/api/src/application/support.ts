import { eventEnvelopeSchema } from '@modivara/core-contracts';
import { InvalidEventError } from './errors.js';

export type ProjectionResult = 'applied' | 'duplicate' | 'ignored';

/** Lee tipo e id sin validar el payload, para deduplicar y enrutar antes del parseo completo. */
export function readEnvelope(event: unknown): { eventId: string; eventType: string } {
  const r = eventEnvelopeSchema.safeParse(event);
  if (!r.success) throw new InvalidEventError('Sobre de evento inválido', r.error.issues);
  return { eventId: r.data.event_id, eventType: r.data.event_type };
}

/** Cualquier esquema Zod de los contracts emisores; estructural para no depender de zod aquí. */
export interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } };
}

export function parseEvent<T>(schema: Parser<T>, event: unknown): T {
  const r = schema.safeParse(event);
  if (!r.success) throw new InvalidEventError('Payload de evento inválido', r.error.issues);
  return r.data;
}
