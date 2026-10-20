import { passwordSchema } from '@modivara/core-contracts';
import { WeakPasswordError } from './errors.js';

/** Política de TECH-001 §16.3, definida una sola vez en contracts. */
export function assertPasswordPolicy(plain: string): void {
  if (!passwordSchema.safeParse(plain).success) {
    throw new WeakPasswordError('Password must have 8+ characters, an uppercase letter and a number');
  }
}
