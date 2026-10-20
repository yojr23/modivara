import type {
  ServiceCallAcknowledgedPayload,
  ServiceCallCompletedPayload,
  ServiceCallCreatedPayload,
  CallStatus,
} from '@modivara/hospitality-contracts';
import { TenantMismatchError } from './errors.js';

export interface ServiceCallFactProps {
  serviceCallId: string;
  organizationId: string;
  locationId: string;
  /** Los campos de `created` son null mientras ese evento no haya llegado (entrega desordenada). */
  tableId: string | null;
  tableLabel: string | null;
  zoneId: string | null;
  zoneName: string | null;
  callType: string | null;
  createdAt: Date | null;
  acknowledgedAt: Date | null;
  completedAt: Date | null;
  pressCount: number;
}

const earliest = (a: Date | null, b: Date): Date => (a && a < b ? a : b);

/**
 * Proyección de un llamado (DATA-001 §5). Cada `apply*` es idempotente y conmutativa:
 * el resultado no depende del orden ni de repeticiones de entrega.
 */
export class ServiceCallFact {
  private constructor(private readonly props: ServiceCallFactProps) {}

  /** Fact vacío a la espera de eventos. */
  static create(identity: { serviceCallId: string; organizationId: string; locationId: string }): ServiceCallFact {
    for (const [k, v] of Object.entries(identity)) {
      if (!v) throw new RangeError(`ServiceCallFact: ${k} is required`);
    }
    return new ServiceCallFact({
      ...identity,
      tableId: null,
      tableLabel: null,
      zoneId: null,
      zoneName: null,
      callType: null,
      createdAt: null,
      acknowledgedAt: null,
      completedAt: null,
      pressCount: 1,
    });
  }

  static restore(props: ServiceCallFactProps): ServiceCallFact {
    return new ServiceCallFact({ ...props });
  }

  get snapshot(): Readonly<ServiceCallFactProps> {
    return this.props;
  }
  get serviceCallId(): string {
    return this.props.serviceCallId;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get locationId(): string {
    return this.props.locationId;
  }

  /** Solo con `created` se conoce mesa y periodo; antes no entra en métricas. */
  get isReady(): boolean {
    return this.props.createdAt !== null;
  }

  get status(): CallStatus {
    if (this.props.completedAt) return 'completed';
    return this.props.acknowledgedAt ? 'in_progress' : 'pending';
  }

  /** `acknowledged_at − created_at` en ms; null si falta alguno. */
  get msToAcknowledge(): number | null {
    return diff(this.props.acknowledgedAt, this.props.createdAt);
  }

  /** `completed_at − created_at` en ms: cierre registrado, no prueba de atención física (TECH-001 §8). */
  get msToComplete(): number | null {
    return diff(this.props.completedAt, this.props.createdAt);
  }

  assertTenant(organizationId: string, locationId: string): void {
    if (organizationId !== this.props.organizationId || locationId !== this.props.locationId) {
      throw new TenantMismatchError(`service call ${this.props.serviceCallId} belongs to another organization or location`);
    }
  }

  applyCreated(p: ServiceCallCreatedPayload): void {
    Object.assign(this.props, {
      tableId: p.table_id,
      tableLabel: p.table_label,
      zoneId: p.zone_id,
      zoneName: p.zone_name,
      callType: p.call_type,
      createdAt: new Date(p.created_at),
    });
  }

  applyAcknowledged(p: ServiceCallAcknowledgedPayload): void {
    this.props.acknowledgedAt = earliest(this.props.acknowledgedAt, new Date(p.acknowledged_at));
    this.props.pressCount = Math.max(this.props.pressCount, p.press_count);
  }

  applyCompleted(p: ServiceCallCompletedPayload): void {
    this.props.completedAt = earliest(this.props.completedAt, new Date(p.completed_at));
    this.props.pressCount = Math.max(this.props.pressCount, p.press_count);
  }
}

function diff(later: Date | null, earlier: Date | null): number | null {
  return later && earlier ? later.getTime() - earlier.getTime() : null;
}
