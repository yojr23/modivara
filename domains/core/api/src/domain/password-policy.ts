import { isValidPassword } from '@modivara/core-contracts';
import { WeakPasswordError } from './errors.js';

/** Política de TECH-001 §16.3, reglas definidas una sola vez en contracts (rules.ts). */
export function assertPasswordPolicy(plain: string): void {
  if (!isValidPassword(plain)) {
    throw new WeakPasswordError('Password must have 8+ characters, an uppercase letter and a number');
  }
}
