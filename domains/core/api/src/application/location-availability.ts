import type { LocationWithOrganization } from './ports/index.js';

/** Regla única de local disponible (D7): local activo Y negocio activo. */
export const isLocationAvailable = ({ location, organizationActive }: LocationWithOrganization): boolean =>
  location.isActive && organizationActive;
