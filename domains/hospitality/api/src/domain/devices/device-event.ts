import { randomUUID } from 'node:crypto';
import type { DeviceEventResult, Transport } from '@modivara/hospitality-contracts';

export interface DeviceEventProps {
  id: string;
  organizationId: string;
  locationId: string;
  gatewayId: string;
  /** null si el código no está registrado. */
  deviceId: string | null;
  deviceCode: string;
  buttonKey: string | null;
  transport: Transport;
  payload: Record<string, unknown>;
  /** Reloj del gateway: no confiable, solo informativo. */
  sentAt: Date | null;
  /** Inicio medible oficial (TECH-001 §8). */
  receivedAt: Date;
  result: DeviceEventResult;
  serviceCallId: string | null;
  correlationId: string;
}

/** Registro inmutable de cada señal recibida. */
export class DeviceEvent {
  private constructor(private readonly props: DeviceEventProps) {}

  static create(input: Omit<DeviceEventProps, 'id' | 'serviceCallId'> & { id?: string; serviceCallId?: string | null }): DeviceEvent {
    return new DeviceEvent({ ...input, id: input.id ?? randomUUID(), serviceCallId: input.serviceCallId ?? null });
  }

  static restore(props: DeviceEventProps): DeviceEvent {
    return new DeviceEvent({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get gatewayId() { return this.props.gatewayId; }
  get deviceId() { return this.props.deviceId; }
  get deviceCode() { return this.props.deviceCode; }
  get buttonKey() { return this.props.buttonKey; }
  get sentAt() { return this.props.sentAt; }
  get receivedAt() { return this.props.receivedAt; }
  get result() { return this.props.result; }
  get serviceCallId() { return this.props.serviceCallId; }
  get correlationId() { return this.props.correlationId; }
  toProps(): DeviceEventProps { return { ...this.props }; }
}
