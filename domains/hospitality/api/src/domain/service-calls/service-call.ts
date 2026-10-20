import { randomUUID } from 'node:crypto';
import type {
  CallStatus,
  CallType,
  ServiceCallAcknowledgedPayload,
  ServiceCallCompletedPayload,
  ServiceCallCreatedPayload,
} from '@modivara/hospitality-contracts';
import type { DomainEvent } from '../domain-event.js';
import { type CallTransitionRecord, transition } from './transitions.js';

export type ServiceCallDomainEvent =
  | DomainEvent<'hospitality.service_call.created', ServiceCallCreatedPayload>
  | DomainEvent<'hospitality.service_call.acknowledged', ServiceCallAcknowledgedPayload>
  | DomainEvent<'hospitality.service_call.completed', ServiceCallCompletedPayload>;

export interface ServiceCallProps {
  id: string;
  organizationId: string;
  locationId: string;
  tableId: string;
  callType: CallType;
  status: CallStatus;
  pressCount: number;
  createdAt: Date;
  lastPressAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  updatedAt: Date;
}

/** Datos de la mesa que viajan en el evento `created` (el agregado no conoce otras entidades). */
export interface TableSnapshot {
  id: string;
  label: string;
  zoneId: string | null;
  zoneName: string | null;
}

export interface CreateServiceCallInput {
  organizationId: string;
  locationId: string;
  table: TableSnapshot;
  callType: CallType;
  /** Pulsación que originó la solicitud. */
  deviceEventId: string;
  correlationId: string;
  now: Date;
}

export class ServiceCall {
  private readonly pendingTransitions: CallTransitionRecord[] = [];
  private readonly pendingEvents: ServiceCallDomainEvent[] = [];

  private constructor(
    private props: ServiceCallProps,
    private loadedStatus: CallStatus | null,
  ) {}

  static create(input: CreateServiceCallInput): ServiceCall {
    const id = randomUUID();
    const call = new ServiceCall(
      {
        id,
        organizationId: input.organizationId,
        locationId: input.locationId,
        tableId: input.table.id,
        callType: input.callType,
        status: 'pending',
        pressCount: 1,
        createdAt: input.now,
        lastPressAt: input.now,
        acknowledgedAt: null,
        acknowledgedBy: null,
        completedAt: null,
        completedBy: null,
        updatedAt: input.now,
      },
      null,
    );
    call.pendingTransitions.push({
      action: 'create',
      fromStatus: null,
      toStatus: 'pending',
      actorUserId: null,
      deviceEventId: input.deviceEventId,
      occurredAt: input.now,
    });
    call.pendingEvents.push(
      call.event('hospitality.service_call.created', input.correlationId, input.now, {
        service_call_id: id,
        table_id: input.table.id,
        table_label: input.table.label,
        zone_id: input.table.zoneId,
        zone_name: input.table.zoneName,
        call_type: input.callType,
        created_at: input.now.toISOString(),
      }),
    );
    return call;
  }

  static restore(props: ServiceCallProps): ServiceCall {
    return new ServiceCall({ ...props }, props.status);
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get tableId() { return this.props.tableId; }
  get callType() { return this.props.callType; }
  get status() { return this.props.status; }
  get pressCount() { return this.props.pressCount; }
  get createdAt() { return this.props.createdAt; }
  get lastPressAt() { return this.props.lastPressAt; }
  get acknowledgedAt() { return this.props.acknowledgedAt; }
  get acknowledgedBy() { return this.props.acknowledgedBy; }
  get completedAt() { return this.props.completedAt; }
  get completedBy() { return this.props.completedBy; }
  get updatedAt() { return this.props.updatedAt; }
  get isActive() { return this.props.status !== 'completed'; }

  /** Estado con el que se leyó de persistencia: el repositorio lo usa para detectar concurrencia. `null` si es nuevo. */
  get persistedStatus(): CallStatus | null { return this.loadedStatus; }
  get transitions(): readonly CallTransitionRecord[] { return this.pendingTransitions; }
  get events(): readonly ServiceCallDomainEvent[] { return this.pendingEvents; }

  /** Nueva pulsación con la solicitud activa: suma sin crear transición ni evento (DATA-001 §3). */
  registerPress(now: Date): void {
    this.props.pressCount += 1;
    this.props.lastPressAt = now;
    this.props.updatedAt = now;
  }

  acknowledge(actorId: string, now: Date, correlationId: string = randomUUID()): void {
    const t = transition(this.props, 'acknowledge', actorId, now);
    this.props.status = t.status;
    this.props.acknowledgedAt = now;
    this.props.acknowledgedBy = actorId;
    this.props.updatedAt = now;
    this.pendingTransitions.push(t.record);
    this.pendingEvents.push(
      this.event('hospitality.service_call.acknowledged', correlationId, now, {
        service_call_id: this.id,
        acknowledged_at: now.toISOString(),
        acknowledged_by: actorId,
        press_count: this.pressCount,
      }),
    );
  }

  complete(actorId: string, now: Date, correlationId: string = randomUUID()): void {
    const t = transition(this.props, 'complete', actorId, now);
    this.props.status = t.status;
    this.props.completedAt = now;
    this.props.completedBy = actorId;
    this.props.updatedAt = now;
    this.pendingTransitions.push(t.record);
    this.pendingEvents.push(
      this.event('hospitality.service_call.completed', correlationId, now, {
        service_call_id: this.id,
        completed_at: now.toISOString(),
        completed_by: actorId,
        press_count: this.pressCount,
      }),
    );
  }

  /** Lo llama el repositorio tras confirmar la transacción. */
  markPersisted(): void {
    this.loadedStatus = this.props.status;
    this.pendingTransitions.length = 0;
    this.pendingEvents.length = 0;
  }

  toProps(): ServiceCallProps {
    return { ...this.props };
  }

  private event<T extends ServiceCallDomainEvent['type']>(
    type: T,
    correlationId: string,
    at: Date,
    payload: Extract<ServiceCallDomainEvent, { type: T }>['payload'],
  ) {
    return {
      eventId: randomUUID(),
      type,
      version: 1,
      occurredAt: at,
      organizationId: this.organizationId,
      locationId: this.locationId,
      aggregateId: this.id,
      correlationId,
      causationId: null,
      payload,
    } as Extract<ServiceCallDomainEvent, { type: T }>;
  }
}
