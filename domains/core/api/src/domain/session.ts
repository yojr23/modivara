import { InvalidValueError, PermissionDeniedError } from './errors.js';

/** Expiración deslizante de 30 días; `touch` escribe como máximo una vez por hora (DATA-001 §2). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionProps {
  id: string;
  userId: string;
  tokenHash: string;
  actingOrganizationId: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
}

export class Session {
  private constructor(private props: SessionProps) {}

  static create(input: {
    id: string;
    userId: string;
    tokenHash: string;
    now: Date;
    ip?: string | null;
    userAgent?: string | null;
  }): Session {
    if (!input.tokenHash) throw new InvalidValueError('Token hash is required');
    return new Session({
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      actingOrganizationId: null,
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: new Date(input.now.getTime() + SESSION_TTL_MS),
      revokedAt: null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  }

  static restore(props: SessionProps): Session {
    return new Session({ ...props });
  }

  get id() { return this.props.id; }
  get userId() { return this.props.userId; }
  get tokenHash() { return this.props.tokenHash; }
  get actingOrganizationId() { return this.props.actingOrganizationId; }
  get createdAt() { return this.props.createdAt; }
  get lastSeenAt() { return this.props.lastSeenAt; }
  get expiresAt() { return this.props.expiresAt; }
  get revokedAt() { return this.props.revokedAt; }
  get ip() { return this.props.ip; }
  get userAgent() { return this.props.userAgent; }

  isValid(now: Date): boolean {
    return this.props.revokedAt === null && this.props.expiresAt > now;
  }

  /** @returns true si se renovó (el llamador debe persistir); false si faltaba menos de una hora. */
  touch(now: Date): boolean {
    if (!this.isValid(now)) return false;
    if (now.getTime() - this.props.lastSeenAt.getTime() < SESSION_TOUCH_INTERVAL_MS) return false;
    this.props.lastSeenAt = now;
    this.props.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    return true;
  }

  revoke(now: Date): void {
    this.props.revokedAt ??= now;
  }

  /** Solo el superadmin opera sobre otro negocio (ADR-002 D3); null vuelve a su propia organización. */
  actAs(organizationId: string | null, actor: { isPlatform: boolean }): void {
    if (!actor.isPlatform) throw new PermissionDeniedError('Only platform users can act on another organization');
    this.props.actingOrganizationId = organizationId;
  }
}
