import { ConflictError } from '../errors.js';
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
  constructor(
    private readonly products: ProductRepository,
  ) {}

  async execute(input: UpdateProductCommand): Promise<Product> {
    const product = await requireProduct(this.products, input.organizationId, input.productId);
    product.update({ name: input.name, sku: input.sku, category: input.category }, input.actorUserId, new Date());

    const sameName = await this.products.findActiveByName(product.organizationId, product.name);
    if (sameName && sameName.id !== product.id) throw new ConflictError(`Ya existe un producto activo llamado "${product.name}"`);
    if (product.sku) {
      const sameSku = await this.products.findActiveBySku(product.organizationId, product.sku);
      if (sameSku && sameSku.id !== product.id) throw new ConflictError(`Ya existe un producto activo con SKU "${product.sku}"`);
    }
    await this.products.save(product);
    return product;
  }
}
