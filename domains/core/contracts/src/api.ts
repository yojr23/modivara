import { z } from 'zod';
import { MODULES, passwordSchema, sessionActorSchema, usernameSchema } from './identity.js';
import { LOCATION_ROLES, PERMISSIONS } from './permissions.js';

/** Rutas de core bajo `/api/v1`, compartidas por la API y el portal. */
export const CORE_API_PATHS = {
  login: '/auth/login',
  logout: '/auth/logout',
  me: '/me',
  users: '/users',
  userPasswordReset: '/users/:userId/password-reset',
  userDeactivate: '/users/:userId/deactivate',
  userRevokeSessions: '/users/:userId/revoke-sessions',
  userLocationRoles: '/users/:userId/locations/:locationId/roles',
  actingOrganization: '/platform/acting-organization',
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

// OPEN: máximo de 100 caracteres para el nombre visible; no está en los documentos.
const displayNameSchema = z.string().trim().min(1).max(100);

export const userResponseSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  display_name: z.string(),
  is_owner: z.boolean(),
  active: z.boolean(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

export const usersResponseSchema = z.object({ users: z.array(userResponseSchema) });
export type UsersResponse = z.infer<typeof usersResponseSchema>;

/** `POST /users`: alta por un admin del negocio (o superadmin operando sobre él). La contraseña sigue la política de TECH-001 §16.3. */
export const createUserRequestSchema = z.object({
  username: usernameSchema,
  display_name: displayNameSchema,
  password: passwordSchema,
  is_owner: z.boolean().optional(),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const resetPasswordRequestSchema = z.object({ new_password: passwordSchema });
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const setLocationRolesRequestSchema = z.object({ roles: z.array(z.enum(LOCATION_ROLES)).min(1) });
export type SetLocationRolesRequest = z.infer<typeof setLocationRolesRequestSchema>;

export const membershipResponseSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  location_id: z.uuid(),
  roles: z.array(z.enum(LOCATION_ROLES)),
});
export type MembershipResponse = z.infer<typeof membershipResponseSchema>;

/** `PUT /platform/acting-organization`: solo superadmin; `null` vuelve a la organización propia. */
export const actingOrganizationRequestSchema = z.object({ organization_id: z.uuid().nullable() });
export type ActingOrganizationRequest = z.infer<typeof actingOrganizationRequestSchema>;

/** Identificador en una ruta (`:userId`, `:locationId`): un valor mal formado es 400, no un error de la base. */
export const idParamSchema = z.uuid();
