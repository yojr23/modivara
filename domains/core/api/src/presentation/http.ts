import type { ActorContext } from '../application/index.js';

// Tipos mínimos de Express: el paquete no depende de @types/express y el controlador solo usa esto.
export interface HttpRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  cookies?: Record<string, string | undefined>;
  params: Record<string, string>;
  body?: unknown;
  /** Lo deja `SessionGuard` (clave `REQUEST_ACTOR_KEY` de core-contracts). */
  actor?: ActorContext;
}

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  expires?: Date;
}

export interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string | number): void;
  cookie(name: string, value: string, options: CookieOptions): void;
  clearCookie(name: string, options: CookieOptions): void;
}

/** HttpOnly + Secure + SameSite=Strict + Path=/ (TECH-001 §16.3). */
export const sessionCookieOptions = (expires?: Date): CookieOptions => ({
  httpOnly: true, secure: true, sameSite: 'strict', path: '/', ...(expires && { expires }),
});

/** Cuerpo de los esquemas del contrato; cualquier objeto con `parse` (los de Zod lo son) sirve. */
export const parseWith = <T>(schema: { parse(input: unknown): T }, input: unknown): T => schema.parse(input);
