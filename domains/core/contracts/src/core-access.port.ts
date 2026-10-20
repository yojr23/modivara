/** Datos de un local que otros dominios necesitan de Core. */
export interface LocationRef {
  id: string;
  organizationId: string;
  timezone: string;
  active: boolean;
}

/**
 * Lo que Core promete responder a los demás dominios (ADR-002 D1).
 * Hoy se implementa en proceso; al separar repositorios será un cliente HTTP, sin cambiar a quien lo consume.
 */
export interface CoreAccessPort {
  getLocation(locationId: string): Promise<LocationRef | null>;
}

/** Token de inyección bajo el que `CoreModule` exporta el `CoreAccessPort`; otros dominios lo inyectan sin importar internos de core. */
export const CORE_ACCESS_PORT = 'CORE_ACCESS_PORT';
