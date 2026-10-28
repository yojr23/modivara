import type { RequestActor } from './authorization.js';
import type { ModuleName } from './identity.js';
import type { Permission } from './permissions.js';

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
  /** ¿El negocio tiene habilitado el módulo? Lo exigen los adaptadores sin sesión (gateway) que no pasan por el guard de módulos. */
  isModuleEnabled(organizationId: string, module: ModuleName): Promise<boolean>;
  /**
   * Autentica un token de sesión fuera de HTTP (p. ej. el handshake de Socket.IO): mismo deslizamiento y revocación que el guard de sesión.
   * `null` si es inválido, expiró o fue revocado.
   */
  authenticateSession(token: string): Promise<RequestActor | null>;
  /**
   * Permisos del actor en el local, con la misma regla que los guards de HTTP. `null` si el local no existe, no está disponible o es de otro
   * negocio (indistinguibles), o si se pide `module` y el negocio no lo tiene habilitado (el superadmin pasa siempre).
   */
  permissionsAt(actor: RequestActor, locationId: string, module?: ModuleName): Promise<ReadonlySet<Permission> | null>;
  /**
   * Nombres visibles de usuarios del negocio, en una sola consulta (usuarios desactivados incluidos). Los ids que no son del negocio
   * ni de la organización plataforma (superadmin que actúa en él) no aparecen en el resultado.
   */
  userDisplayNames(ref: { organizationId: string; userIds: readonly string[] }): Promise<Map<string, string>>;
}

/** Token de inyección bajo el que `CoreModule` exporta el `CoreAccessPort`; otros dominios lo inyectan sin importar internos de core. */
export const CORE_ACCESS_PORT = 'CORE_ACCESS_PORT';
