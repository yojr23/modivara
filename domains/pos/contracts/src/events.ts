import { defineEvent } from '@modivara/core-contracts';
import { z } from 'zod';
import { currencySchema, paymentMethodSchema, priceSchema, quantitySchema, unitSchema } from './catalog.js';

/**
 * Venta cerrada, genérica: sin referencias a otros productos. Inventario y Analytics pueden suscribirse,
 * pero ningún consumidor es necesario para cerrar una venta (PLAN-POS-001 §3).
 */
export const saleCompletedV1 = defineEvent(
  'pos.sale.completed',
  1,
  z.object({
    sale_id: z.uuid(),
    currency: currencySchema,
    total: priceSchema,
    payment_method: paymentMethodSchema,
    completed_at: z.iso.datetime({ offset: true }),
    actor_user_id: z.uuid(),
    lines: z
      .array(
        z.object({
          line_id: z.uuid(),
          sellable_item_id: z.uuid(),
          sku: z.string().nullable(),
          name: z.string().min(1),
          unit: unitSchema,
          unit_price: priceSchema,
          quantity: quantitySchema,
          line_total: priceSchema,
        }),
      )
      .min(1),
  }),
);
export type SaleCompletedV1 = z.infer<typeof saleCompletedV1>;
export type SaleCompletedPayload = SaleCompletedV1['payload'];

export const SALE_COMPLETED = 'pos.sale.completed';
