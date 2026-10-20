import { SKU_MAX_LENGTH, type Unit, UNITS } from '@modivara/commerce-contracts';
import { InactiveEntityError, InvalidValueError } from './errors.js';
import { optionalText, requireText } from './name.js';

export interface ProductProps {
  id: string;
  // OPEN: catálogo por negocio (propuesto) o por local — DATA-001 §8.3 pendiente.
  organizationId: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: Unit;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
}

export interface CreateProductInput {
  id: string;
  organizationId: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  unit: Unit;
  actorUserId: string;
  now: Date;
}

// Sin variantes ni precios (provisional, TECH-001 §16.8).
export class Product {
  private constructor(private props: ProductProps) {}

  static create(input: CreateProductInput): Product {
    if (!UNITS.includes(input.unit)) throw new InvalidValueError(`Invalid unit: ${input.unit}`);
    return new Product({
      id: input.id,
      organizationId: input.organizationId,
      name: requireText('Name', input.name),
      sku: optionalText('SKU', input.sku, SKU_MAX_LENGTH),
      category: optionalText('Category', input.category),
      unit: input.unit,
      deactivatedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    });
  }

  static restore(props: ProductProps): Product {
    return new Product({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get name() { return this.props.name; }
  get sku() { return this.props.sku; }
  get category() { return this.props.category; }
  get unit() { return this.props.unit; }
  get deactivatedAt() { return this.props.deactivatedAt; }
  get isActive() { return this.props.deactivatedAt === null; }

  /** La unidad no se edita (ver updateProductSchema). `undefined` = sin cambio, `null` = borrar. */
  update(
    changes: { name?: string; sku?: string | null; category?: string | null },
    actorUserId: string,
    now: Date,
  ): void {
    this.assertActive();
    const p = this.props;
    if (changes.name !== undefined) p.name = requireText('Name', changes.name);
    if (changes.sku !== undefined) p.sku = optionalText('SKU', changes.sku, SKU_MAX_LENGTH);
    if (changes.category !== undefined) p.category = optionalText('Category', changes.category);
    p.updatedAt = now;
    p.updatedBy = actorUserId;
  }

  deactivate(actorUserId: string, now: Date): void {
    this.assertActive();
    this.props.deactivatedAt = now;
    this.props.updatedAt = now;
    this.props.updatedBy = actorUserId;
  }

  toProps(): ProductProps {
    return { ...this.props };
  }

  private assertActive(): void {
    if (!this.isActive) throw new InactiveEntityError('Product is deactivated');
  }
}
