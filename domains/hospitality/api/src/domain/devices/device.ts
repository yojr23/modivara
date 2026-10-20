import { newId } from '@modivara/core-contracts';
import { ValidationError } from '../errors.js';

export interface DeviceProps {
  id: string;
  organizationId: string;
  locationId: string;
  /** Identificador que envía el botón/gateway. */
  code: string;
  /** Referencia de hardware; define la traducción tecla → call_type en el adaptador. */
  model: string | null;
  createdAt: Date;
  createdBy: string | null;
  deactivatedAt: Date | null;
}

export class Device {
  private constructor(private readonly props: DeviceProps) {}

  static create(input: { organizationId: string; locationId: string; code: string; model?: string | null; createdBy: string; now: Date }): Device {
    const code = input.code.trim();
    if (!code) throw new ValidationError('Device code is required');
    return new Device({
      id: newId(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      code,
      model: input.model?.trim() || null,
      createdAt: input.now,
      createdBy: input.createdBy,
      deactivatedAt: null,
    });
  }

  static restore(props: DeviceProps): Device {
    return new Device({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get code() { return this.props.code; }
  get model() { return this.props.model; }
  get isActive() { return this.props.deactivatedAt === null; }
  toProps(): DeviceProps { return { ...this.props }; }
}
