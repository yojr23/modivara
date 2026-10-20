import { ConflictError } from '../../domain/errors.js';
import type { Product } from '../../domain/product.js';
import type { ProductRepository } from '../ports/product.repository.js';
import { type ActorContext, requireProduct } from './shared.js';

export interface UpdateProductCommand extends ActorContext {
  productId: string;
  name?: string;
  sku?: string | null;
  category?: string | null;
}

export class UpdateProduct {
  constructor(private readonly products: ProductRepository) {}

  async execute(input: UpdateProductCommand): Promise<Product> {
    const product = await requireProduct(this.products, { id: input.productId, organizationId: input.organizationId });
    const { name: oldName, sku: oldSku } = product;
    product.update({ name: input.name, sku: input.sku, category: input.category }, input.actorUserId, new Date());
    const { organizationId } = product;

    // Uniqueness is only queried for the fields that actually changed.
    if (product.name !== oldName) {
      const same = await this.products.findActiveByName({ organizationId, name: product.name });
      if (same && same.id !== product.id) throw new ConflictError(`An active product named "${product.name}" already exists`);
    }
    if (product.sku && product.sku !== oldSku) {
      const same = await this.products.findActiveBySku({ organizationId, sku: product.sku });
      if (same && same.id !== product.id) throw new ConflictError(`An active product with SKU "${product.sku}" already exists`);
    }
    await this.products.save(product);
    return product;
  }
}
