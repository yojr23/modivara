import type { Clock } from '../ports/clock.port.js';
import type { ProductRepository } from '../ports/product.repository.js';
import { type ActorContext, requireProduct } from './shared.js';

export class DeactivateProduct {
  constructor(
    private readonly products: ProductRepository,
    private readonly clock: Clock,
  ) {}

  // OPEN: ¿se puede desactivar un producto con saldo > 0? Hoy sí; el historial no se borra (DATA-001 §1).
  async execute(input: ActorContext & { productId: string }): Promise<void> {
    const product = await requireProduct(this.products, input.organizationId, input.productId);
    product.deactivate(input.actorUserId, this.clock.now());
    await this.products.save(product);
  }
}
