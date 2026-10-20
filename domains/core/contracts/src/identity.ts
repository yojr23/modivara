import { z } from 'zod';

/** Módulos habilitables por negocio (DATA-001 §2, core.module). */
export const MODULES = ['hospitality', 'commerce', 'analytics'] as const;
export type ModuleName = (typeof MODULES)[number];

/** Slugs que el sistema usa en rutas o infraestructura; no se asignan a clientes (DATA-001 §2). */
export const RESERVED_SLUGS = ['labs', 'api', 'sim', 'assets', 'login', 'static'] as const;

// OPEN: longitudes de slug (3–40) y username (3–32) son propuesta de DATA-001 §8.1, pendientes de confirmar.
/** Formato de slug; sirve para identificar el negocio en el login (incluye `labs`). */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Slug asignable a un negocio cliente: formato válido y no reservado. */
export const customerSlugSchema = slugSchema.refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), {
  message: 'reserved_slug',
});

// OPEN: longitud de username (3–32) es propuesta de DATA-001 §8.1.
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/);

// OPEN: el máximo de 128 no está en los documentos; evita enviar cadenas enormes al hash.
/** Política de contraseña (TECH-001 §16.3): mínimo 8, al menos 1 mayúscula y 1 número. */
export const passwordSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/[A-Z]/, 'needs_uppercase')
  .regex(/[0-9]/, 'needs_number');

export const loginRequestSchema = z.object({
  slug: slugSchema,
  username: usernameSchema,
  // En el login no se aplica la política: solo se compara contra el hash.
  password: z.string().min(1).max(128),
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
