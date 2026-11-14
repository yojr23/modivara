import { SKU_MAX_LENGTH, type Unit } from '@modivara/pos-contracts';
import { InactiveEntityError } from './errors.js';
import { optionalText, parsePrice, requireCurrency, requireText, requireUnit } from './values.js';

export interface SellableItemProps {
  id: string;
  organizationId: string;
  /** Catálogo de venta por local; nombre y SKU únicos entre activos del local. */
  locationId: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: Unit;
  /** Centésimas de `currency`. */
  price: bigint;
  currency: string;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface CreateSellableItemInput {
  id: string;
  organizationId: string;
  locationId: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  unit: string;
  price: string;
  currency: string;
  actorUserId: string;
  now: Date;
}

/**
 * Lo que se ofrece y a qué precio. No es un producto de inventario: las existencias y consumos los decide
 * otro producto, si está contratado (PLAN-POS-001 §1, regla 5).
 */
export class SellableItem {
  private constructor(private props: SellableItemProps) {}

  static create(input: CreateSellableItemInput): SellableItem {
    return new SellableItem({
      id: input.id,
      organizationId: input.organizationId,
      locationId: input.locationId,
      name: requireText('Name', input.name),
      sku: optionalText('SKU', input.sku, SKU_MAX_LENGTH),
      category: optionalText('Category', input.category),
      unit: requireUnit(input.unit),
      price: parsePrice(input.price),
      currency: requireCurrency(input.currency),
      deactivatedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    });
  }

  static restore(props: SellableItemProps): SellableItem {
    return new SellableItem({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get name() { return this.props.name; }
  get sku() { return this.props.sku; }
  get category() { return this.props.category; }
  get unit() { return this.props.unit; }
  get price() { return this.props.price; }
  get currency() { return this.props.currency; }
  get isActive() { return this.props.deactivatedAt === null; }

  /**
   * Unidad y moneda no se editan: cambiarlas alteraría el significado de ventas abiertas.
   * `undefined` = sin cambio, `null` = borrar. Las líneas ya vendidas conservan su snapshot.
   */
  update(
    changes: { name?: string; sku?: string | null; category?: string | null; price?: string },
    actorUserId: string,
    now: Date,
  ): void {
    this.assertActive();
    const p = this.props;
    if (changes.name !== undefined) p.name = requireText('Name', changes.name);
    if (changes.sku !== undefined) p.sku = optionalText('SKU', changes.sku, SKU_MAX_LENGTH);
    if (changes.category !== undefined) p.category = optionalText('Category', changes.category);
    if (changes.price !== undefined) p.price = parsePrice(changes.price);
    p.updatedAt = now;
    p.updatedBy = actorUserId;
  }

  deactivate(actorUserId: string, now: Date): void {
    this.assertActive();
    this.props.deactivatedAt = now;
    this.props.updatedAt = now;
    this.props.updatedBy = actorUserId;
  }

  assertActive(): void {
    if (!this.isActive) throw new InactiveEntityError('Sellable item is deactivated');
  }

  toProps(): SellableItemProps {
    return { ...this.props };
  }
}
