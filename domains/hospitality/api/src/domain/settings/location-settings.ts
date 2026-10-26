import type { CallVisibility } from '@modivara/hospitality-contracts';

export interface LocationSettings {
  callVisibility: CallVisibility;
}

/** Valores cuando el local no tiene fila en `location_settings` (DATA-001 §3): el suscriptor de core.location.created la crea con el local; sin ella (locales anteriores) valen estos. */
export const DEFAULT_LOCATION_SETTINGS: LocationSettings = { callVisibility: 'all' };
