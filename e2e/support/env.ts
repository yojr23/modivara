import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost';
export const AUTH_DIR = join(ROOT, 'e2e', '.auth');

/** Clave de los usuarios de demo: `SEED_PASSWORD` del entorno o, si no está, de `.env` (la misma que usó `pnpm seed`). */
export function seedPassword(): string {
  if (process.env.SEED_PASSWORD) return process.env.SEED_PASSWORD;
  const file = join(ROOT, '.env');
  const value = existsSync(file) ? readFileSync(file, 'utf8').match(/^SEED_PASSWORD=(.*)$/m)?.[1]?.trim() : undefined;
  if (!value) throw new Error('Falta SEED_PASSWORD (entorno o .env): es la clave con la que se sembraron los usuarios de demo.');
  return value;
}

/** Sesiones que prepara global-setup (una por usuario, para no gastar el límite de 30 logins por IP cada 15 min). */
export const USERS = [
  ['bar-demo', 'admin'], ['bar-demo', 'barra'], ['bar-demo', 'inventario1'], ['bar-demo-pisos', 'admin'],
] as const;
export type User = (typeof USERS)[number];
export const authFile = ([slug, user]: User) => join(AUTH_DIR, `${slug}-${user}.json`);
export const gatewayFile = (slug: string) => join(AUTH_DIR, `gateway-${slug}.json`);
