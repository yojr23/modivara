// Reglas de validación como constantes puras, sin Zod: una sola fuente de verdad
// para los esquemas de transporte (identity.ts) y para el dominio.

/** Slugs que el sistema usa en rutas o infraestructura; no se asignan a clientes (DATA-001 §2). */
export const RESERVED_SLUGS = ['labs', 'api', 'sim', 'assets', 'login', 'static'] as const;

// OPEN: longitudes de slug (3–40) y username (3–32) son propuesta de DATA-001 §8.1, pendientes de confirmar.
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
export const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_REGEX = /^[a-z0-9._-]+$/;

// OPEN: el máximo de 128 no está en los documentos; evita enviar cadenas enormes al hash.
/** Política de contraseña (TECH-001 §16.3): mínimo 8, al menos 1 mayúscula y 1 número. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const PASSWORD_UPPERCASE_REGEX = /[A-Z]/;
export const PASSWORD_NUMBER_REGEX = /[0-9]/;

export const isReservedSlug = (s: string): boolean => (RESERVED_SLUGS as readonly string[]).includes(s);

/** Slug en forma canónica (minúsculas, sin espacios) y con formato válido. */
export const isValidSlug = (s: string): boolean =>
  s === s.trim().toLowerCase() && s.length >= SLUG_MIN && s.length <= SLUG_MAX && SLUG_REGEX.test(s);

/** Username en forma canónica (minúsculas, sin espacios) y con formato válido. */
export const isValidUsername = (s: string): boolean =>
  s === s.trim().toLowerCase() && s.length >= USERNAME_MIN && s.length <= USERNAME_MAX && USERNAME_REGEX.test(s);

export const isValidPassword = (s: string): boolean =>
  s.length >= PASSWORD_MIN && s.length <= PASSWORD_MAX && PASSWORD_UPPERCASE_REGEX.test(s) && PASSWORD_NUMBER_REGEX.test(s);
