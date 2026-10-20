import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from './argon2-password-hasher.js';
import { CryptoSessionTokenService } from './crypto-session-token.service.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();
  it('genera argon2id con sal distinta y verifica', async () => {
    const [a, b] = await Promise.all([hasher.hash('Secret123'), hasher.hash('Secret123')]);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toBe(b);
    expect(await hasher.verify(a, 'Secret123')).toBe(true);
    expect(await hasher.verify(a, 'Secret124')).toBe(false);
  });
  it('un hash corrupto no verifica ni lanza', async () => {
    expect(await hasher.verify('no-es-un-hash', 'x')).toBe(false);
  });
});

describe('CryptoSessionTokenService', () => {
  const svc = new CryptoSessionTokenService();
  it('genera tokens de 32 bytes únicos y su SHA-256, sin guardar el token', () => {
    const a = svc.generate();
    const b = svc.generate();
    expect(Buffer.from(a.token, 'base64url')).toHaveLength(32);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
    expect(svc.hash(a.token)).toBe(a.tokenHash);
  });
});
