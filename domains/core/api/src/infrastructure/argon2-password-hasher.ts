import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '../application/ports/index.js';

/**
 * Argon2id (TECH-001 §16.3). `@node-rs/argon2` usa Argon2id por defecto; se evita importar el
 * `const enum Algorithm` porque no es compatible con isolatedModules. La prueba verifica el prefijo `$argon2id$`.
 */
// OPEN: parámetros de coste (memoria/iteraciones); se usan los valores por defecto de la librería.
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return hash(plain);
  }

  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      // Un hash corrupto equivale a credencial inválida, no a error del servidor.
      return false;
    }
  }
}
