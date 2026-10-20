import { InvalidEventError } from '../domain/index.js';

export type ProjectionResult = 'applied' | 'duplicate' | 'ignored';

/** Cualquier esquema Zod de los contracts emisores; estructural para no depender de zod aquí. */
export interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } };
}

/** Lee solo `event_type` para enrutar; el sobre y el payload se validan una vez con el esquema del tipo. */
export function readEventType(event: unknown): string {
  const type = (event as { event_type?: unknown } | null)?.event_type;
  if (typeof type !== 'string') throw new InvalidEventError('Invalid event envelope');
  return type;
}

export function parseEvent<T>(schema: Parser<T>, event: unknown): T {
  const r = schema.safeParse(event);
  if (!r.success) throw new InvalidEventError('Invalid event payload', r.error.issues);
  return r.data;
}
