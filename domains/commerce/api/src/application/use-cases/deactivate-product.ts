import type { CoreAccessPort } from '@modivara/core-contracts';
import type { ProductRepository } from '../ports/product.repository.js';
import { type StockContext, requireLocation, requireProduct } from './shared.js';

export class DeactivateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly core: CoreAccessPort,
  ) {}

  // OPEN: ¿se puede desactivar un producto con saldo > 0? Hoy sí; el historial no se borra (DATA-001 §1).
  async execute(input: StockContext & { productId: string }): Promise<void> {
    await requireLocation(this.core, input.organizationId, input.locationId);
    const product = await requireProduct(this.products, { id: input.productId, organizationId: input.organizationId, locationId: input.locationId });
    product.deactivate(input.actorUserId, new Date());
    await this.products.save(product);
  }
}
