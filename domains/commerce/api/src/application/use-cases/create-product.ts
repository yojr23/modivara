import type { Unit } from '@modivara/commerce-contracts';
import { Product } from '../../domain/product.js';
import { type CoreAccessPort, newId } from '@modivara/core-contracts';
import { ConflictError } from '../../domain/errors.js';
import type { ProductRepository } from '../ports/product.repository.js';
import { type StockContext, requireLocation } from './shared.js';

export interface CreateProductCommand extends StockContext {
  name: string;
  sku?: string;
  category?: string;
  unit: Unit;
}

export class CreateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly core: CoreAccessPort,
  ) {}

  async execute(input: CreateProductCommand): Promise<Product> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    const product = Product.create({ ...input, id: newId(), now: new Date() });
    if (await this.products.findActiveByName({ organizationId: product.organizationId, locationId: product.locationId, name: product.name })) {
      throw new ConflictError(`An active product named "${product.name}" already exists`);
    }
    if (product.sku && (await this.products.findActiveBySku({ organizationId: product.organizationId, locationId: product.locationId, sku: product.sku }))) {
      throw new ConflictError(`An active product with SKU "${product.sku}" already exists`);
    }
    await this.products.save(product);
    return product;
  }
}
