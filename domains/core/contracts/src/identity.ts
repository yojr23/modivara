import { z } from 'zod';
import {
  PASSWORD_MAX, PASSWORD_MIN, PASSWORD_NUMBER_REGEX, PASSWORD_UPPERCASE_REGEX,
  SLUG_MAX, SLUG_MIN, SLUG_REGEX, USERNAME_MAX, USERNAME_MIN, USERNAME_REGEX, isReservedSlug,
} from './rules.js';

/** Módulos habilitables por negocio (DATA-001 §2, core.module). */
export const MODULES = ['hospitality', 'commerce', 'analytics'] as const;
export type ModuleName = (typeof MODULES)[number];

/** Formato de slug; sirve para identificar el negocio en el login (incluye `labs`). */
export const slugSchema = z.string().trim().toLowerCase().min(SLUG_MIN).max(SLUG_MAX).regex(SLUG_REGEX);

/** Slug asignable a un negocio cliente: formato válido y no reservado. */
export const customerSlugSchema = slugSchema.refine((s) => !isReservedSlug(s), { message: 'reserved_slug' });

export const usernameSchema = z.string().trim().toLowerCase().min(USERNAME_MIN).max(USERNAME_MAX).regex(USERNAME_REGEX);

/** Política de contraseña (TECH-001 §16.3). */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN)
  .max(PASSWORD_MAX)
  .regex(PASSWORD_UPPERCASE_REGEX, 'needs_uppercase')
  .regex(PASSWORD_NUMBER_REGEX, 'needs_number');

export const loginRequestSchema = z.object({
  slug: slugSchema,
  username: usernameSchema,
  // En el login no se aplica la política: solo se compara contra el hash.
  password: z.string().min(1).max(PASSWORD_MAX),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Actor autenticado visible al frontend. Sin hash, token ni contadores de bloqueo. */
export const sessionActorSchema = z.object({
  user_id: z.uuid(),
  organization_id: z.uuid(),
  username: z.string(),
  display_name: z.string(),
  is_owner: z.boolean(),
  is_platform: z.boolean(),
  acting_organization_id: z.uuid().nullable(),
});
export type SessionActor = z.infer<typeof sessionActorSchema>;

export const loginResponseSchema = z.object({
  actor: sessionActorSchema,
  expires_at: z.iso.datetime({ offset: true }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
