import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@modivara/core-contracts';
import { GATEWAY_DISCONNECTED_AFTER_MS } from '@modivara/hospitality-contracts';
import { ValidationError } from '../errors.js';

export interface GatewayProps {
  id: string;
  organizationId: string;
  locationId: string;
  name: string;
  /** SHA-256 (hex) de la clave HTTP. */
  keyHash: string;
  lastSeenAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
  deactivatedAt: Date | null;
}

export class Gateway {
  private constructor(private readonly props: GatewayProps) {}

  static hashKey(plainKey: string): string {
    return createHash('sha256').update(plainKey).digest('hex');
  }

  /** Devuelve la clave en claro una sola vez; solo su hash queda en el agregado. */
  static create(input: { organizationId: string; locationId: string; name: string; createdBy: string; now: Date }): { gateway: Gateway; plainKey: string } {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Gateway name is required');
    const plainKey = `mvg_${randomBytes(32).toString('base64url')}`;
    const gateway = new Gateway({
      id: newId(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      name,
      keyHash: Gateway.hashKey(plainKey),
      lastSeenAt: null,
      createdAt: input.now,
      createdBy: input.createdBy,
      deactivatedAt: null,
    });
    return { gateway, plainKey };
  }

  static restore(props: GatewayProps): Gateway {
    return new Gateway({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get name() { return this.props.name; }
  get keyHash() { return this.props.keyHash; }
  get lastSeenAt() { return this.props.lastSeenAt; }
  get isActive() { return this.props.deactivatedAt === null; }

  recordHeartbeat(now: Date): void {
    this.props.lastSeenAt = now;
  }

  /** Conectado mientras no pasen más de 90 s desde la última señal. */
  isConnected(now: Date): boolean {
    return this.props.lastSeenAt !== null && now.getTime() - this.props.lastSeenAt.getTime() <= GATEWAY_DISCONNECTED_AFTER_MS;
  }

  toProps(): GatewayProps { return { ...this.props }; }
}
