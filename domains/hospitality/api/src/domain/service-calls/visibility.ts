import type { CallVisibility } from '@modivara/hospitality-contracts';
import type { Permission } from '@modivara/core-contracts';
import type { ServiceCall } from './service-call.js';

export interface Viewer {
  userId: string;
  /** Local desde el que consulta (contexto autorizado en el servidor). */
  locationId: string;
  permissions: ReadonlySet<Permission>;
}

/** Toda consulta y aviso de llamados pasa por aquí (TECH-001 §16.4). */
export function canSeeCall(viewer: Viewer, call: Pick<ServiceCall, 'locationId'>, visibility: CallVisibility = 'all'): boolean {
  if (call.locationId !== viewer.locationId) return false;
  if (!viewer.permissions.has('hospitality.calls.read')) return false;
  switch (visibility) {
    case 'all':
      return true;
    // OPEN: modo `assigned` (el mesero ve solo sus mesas) sin diseñar; se agrega aquí como otro `case`.
  }
}
