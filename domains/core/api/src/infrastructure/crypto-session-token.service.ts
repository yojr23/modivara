import { createHash, randomBytes } from 'node:crypto';
import type { SessionTokenService } from '../application/ports/index.js';

export class CryptoSessionTokenService implements SessionTokenService {
  generate() {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  /** SHA-256 en hex; el adaptador de persistencia lo guarda como bytea. */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
