import { z } from 'zod';
import { MODULES, sessionActorSchema } from './identity.js';
import { PERMISSIONS } from './permissions.js';

/** Rutas de core bajo `/api/v1`, compartidas por la API y el portal. */
export const CORE_API_PATHS = {
  login: '/auth/login',
  logout: '/auth/logout',
  me: '/me',
} as const;

/** Cookie de sesión: HttpOnly, Secure, SameSite=Strict (TECH-001 §16.3). El valor es el token en claro; la base guarda su SHA-256. */
export const SESSION_COOKIE = 'modivara_session';

/** Cuerpo de todo error de la API: el portal decide por `code` (snake_case estable del DomainError), nunca por texto. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * `GET /me`: lo que el portal necesita para armar la sesión y la navegación.
 * La UI oculta lo no contratado, pero la autorización siempre la decide el backend.
 */
export const meResponseSchema = z.object({
  actor: sessionActorSchema,
  /** Negocio sobre el que opera; null solo para un superadmin que aún no eligió negocio. */
  organization: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
  /** Módulos habilitados del negocio (entitlements). */
  modules: z.array(z.enum(MODULES)),
  /** Locales a los que accede, con sus permisos efectivos (`permissionsFor`). */
  locations: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      timezone: z.string(),
      permissions: z.array(z.enum(PERMISSIONS)),
    }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
