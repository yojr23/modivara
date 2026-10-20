export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

export interface SessionTokenService {
  /** Token aleatorio para la cookie y su hash para guardar; el token nunca se persiste. */
  generate(): { token: string; tokenHash: string };
  hash(token: string): string;
}
