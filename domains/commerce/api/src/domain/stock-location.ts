import { InactiveEntityError } from './errors.js';
import { requireText } from './name.js';

export const DEFAULT_STOCK_LOCATION_NAME = 'Principal';

export interface StockLocationProps {
  id: string;
  organizationId: string;
  locationId: string;
  name: string;
  isDefault: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface CreateStockLocationInput {
  id: string;
  organizationId: string;
  locationId: string;
  name?: string;
  isDefault?: boolean;
  actorUserId: string;
  now: Date;
}

/** Lugar de stock dentro de un local (bodega, barra…). "Principal" es el predeterminado. */
export class StockLocation {
  private constructor(private props: StockLocationProps) {}

  static create(input: CreateStockLocationInput): StockLocation {
    const isDefault = input.isDefault ?? false;
    return new StockLocation({
      id: input.id,
      organizationId: input.organizationId,
      locationId: input.locationId,
      name: requireText('Name', input.name ?? (isDefault ? DEFAULT_STOCK_LOCATION_NAME : '')),
      isDefault,
      deactivatedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    });
  }

  static restore(props: StockLocationProps): StockLocation {
    return new StockLocation({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get name() { return this.props.name; }
  get isDefault() { return this.props.isDefault; }
  get isActive() { return this.props.deactivatedAt === null; }

  assertActive(): void {
    if (!this.isActive) throw new InactiveEntityError('Stock location is deactivated');
  }

  toProps(): StockLocationProps {
    return { ...this.props };
  }
}
