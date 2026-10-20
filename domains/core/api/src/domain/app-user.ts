import { usernameSchema } from '@modivara/core-contracts';
import { InvalidValueError } from './errors.js';

/** Política de bloqueo (TECH-001 §16.3): 5 fallos dentro de 15 minutos. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

export interface AppUserProps {
  id: string;
  organizationId: string;
  username: string;
  displayName: string;
  passwordHash: string;
  isOwner: boolean;
  passwordChangedAt: Date;
  failedLoginCount: number;
  failedLoginWindowStart: Date | null;
  deactivatedAt: Date | null;
}

export class AppUser {
  private constructor(private props: AppUserProps) {}

  static create(input: {
    id: string;
    organizationId: string;
    username: string;
    displayName: string;
    passwordHash: string;
    isOwner?: boolean;
    now: Date;
  }): AppUser {
    if (!usernameSchema.safeParse(input.username).success || input.username !== input.username.toLowerCase()) {
      throw new InvalidValueError(`Invalid username: ${input.username}`);
    }
    const displayName = input.displayName.trim();
    if (!displayName) throw new InvalidValueError('Display name is required');
    if (!input.passwordHash) throw new InvalidValueError('Password hash is required');
    return new AppUser({
      id: input.id,
      organizationId: input.organizationId,
      username: input.username,
      displayName,
      passwordHash: input.passwordHash,
      isOwner: input.isOwner ?? false,
      passwordChangedAt: input.now,
      failedLoginCount: 0,
      failedLoginWindowStart: null,
      deactivatedAt: null,
    });
  }

  static restore(props: AppUserProps): AppUser {
    return new AppUser({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get username() { return this.props.username; }
  get displayName() { return this.props.displayName; }
  get passwordHash() { return this.props.passwordHash; }
  get isOwner() { return this.props.isOwner; }
  get passwordChangedAt() { return this.props.passwordChangedAt; }
  get failedLoginCount() { return this.props.failedLoginCount; }
  get failedLoginWindowStart() { return this.props.failedLoginWindowStart; }
  get deactivatedAt() { return this.props.deactivatedAt; }
  get isActive() { return this.props.deactivatedAt === null; }

  /** Fin del bloqueo, o null si no está bloqueado: se libera al vencer la ventana. */
  lockedUntil(now: Date): Date | null {
    const start = this.props.failedLoginWindowStart;
    if (!start || this.props.failedLoginCount < MAX_FAILED_LOGINS) return null;
    const end = new Date(start.getTime() + LOCK_WINDOW_MS);
    return end > now ? end : null;
  }

  registerFailedLogin(now: Date): void {
    const start = this.props.failedLoginWindowStart;
    const expired = !start || start.getTime() + LOCK_WINDOW_MS <= now.getTime();
    if (expired) {
      this.props.failedLoginCount = 1;
      this.props.failedLoginWindowStart = now;
    } else {
      this.props.failedLoginCount += 1;
    }
  }

  /** @returns true si había algo que limpiar (evita escrituras innecesarias). */
  registerSuccessfulLogin(): boolean {
    const dirty = this.props.failedLoginCount !== 0 || this.props.failedLoginWindowStart !== null;
    this.props.failedLoginCount = 0;
    this.props.failedLoginWindowStart = null;
    return dirty;
  }

  changePassword(passwordHash: string, now: Date): void {
    if (!passwordHash) throw new InvalidValueError('Password hash is required');
    this.props.passwordHash = passwordHash;
    this.props.passwordChangedAt = now;
    // Un restablecimiento por admin también libera un bloqueo vigente.
    this.registerSuccessfulLogin();
  }

  deactivate(now: Date): void {
    this.props.deactivatedAt ??= now;
  }
}
