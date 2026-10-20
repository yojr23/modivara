import type { Unit } from '@modivara/commerce-contracts';
import { Product } from '../../domain/product.js';
import { ConflictError } from '../errors.js';
import type { IdGenerator } from '../ports/id-generator.port.js';
import type { ProductRepository } from '../ports/product.repository.js';
import type { ActorContext } from './shared.js';

export interface CreateProductCommand extends ActorContext {
  name: string;
  sku?: string;
  category?: string;
  unit: Unit;
}

export class CreateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: CreateProductCommand): Promise<Product> {
    const product = Product.create({ ...input, id: this.ids.next(), now: new Date() });
    if (await this.products.findActiveByName(product.organizationId, product.name)) {
      throw new ConflictError(`Ya existe un producto activo llamado "${product.name}"`);
    }
    if (product.sku && (await this.products.findActiveBySku(product.organizationId, product.sku))) {
      throw new ConflictError(`Ya existe un producto activo con SKU "${product.sku}"`);
    }
    await this.products.save(product);
    return product;
  }
}
