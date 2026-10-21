import type { CallVisibility } from '@modivara/hospitality-contracts';

export interface LocationSettings {
  callVisibility: CallVisibility;
}

/** Valores cuando el local no tiene fila en `location_settings` (DATA-001 §3): se crea perezosamente al editarlos, no al crear el local. */
export const DEFAULT_LOCATION_SETTINGS: LocationSettings = { callVisibility: 'all' };
