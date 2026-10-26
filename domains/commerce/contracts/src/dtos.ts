import { z } from 'zod';
import {
  isZeroQuantity,
  movementDirectionSchema,
  NAME_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  signedQuantitySchema,
  SKU_MAX_LENGTH,
  unitSchema,
  unsignedQuantitySchema,
} from './catalog.js';

const name = z.string().trim().min(1).max(NAME_MAX_LENGTH);
const sku = z.string().trim().min(1).max(SKU_MAX_LENGTH);
const category = z.string().trim().min(1).max(NAME_MAX_LENGTH);
const note = z.string().trim().min(1).max(NOTE_MAX_LENGTH);

export const createProductSchema = z.object({
  name,
  sku: sku.optional(),
  category: category.optional(),
  unit: unitSchema,
});
export type CreateProductDto = z.infer<typeof createProductSchema>;

// La unidad no se edita: cambiarla con saldo existente reinterpretaría las cantidades. null borra el campo.
export const updateProductSchema = z.object({
  name: name.optional(),
  sku: sku.nullable().optional(),
  category: category.nullable().optional(),
});
export type UpdateProductDto = z.infer<typeof updateProductSchema>;

export const createStockLocationSchema = z.object({ name });
export type CreateStockLocationDto = z.infer<typeof createStockLocationSchema>;

export const createMovementReasonSchema = z.object({ name, direction: movementDirectionSchema });
export type CreateMovementReasonDto = z.infer<typeof createMovementReasonSchema>;

/**
 * `quantity`: magnitud > 0 para `in`/`out` (el signo lo pone la dirección);
 * delta con signo y ≠ 0 para `adjust`. organization_id y location_id nunca vienen del cliente.
 * La clave de idempotencia va en el header `Idempotency-Key` (ver api.ts), no en el cuerpo.
 */
export const registerMovementSchema = z
  .object({
    stock_location_id: z.uuid(),
    product_id: z.uuid(),
    direction: movementDirectionSchema,
    reason_id: z.uuid(),
    quantity: signedQuantitySchema,
    note: note.optional(),
  })
  .superRefine((dto, ctx) => {
    if (isZeroQuantity(dto.quantity)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'La cantidad no puede ser cero' });
    } else if (dto.direction !== 'adjust' && dto.quantity.startsWith('-')) {
      ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'Entrada y salida usan cantidad positiva' });
    }
  });
export type RegisterMovementDto = z.infer<typeof registerMovementSchema>;

/** La UI envía lo contado; la API calcula delta = contado − saldo (DATA-001 §4). */
export const adjustToCountSchema = z.object({
  stock_location_id: z.uuid(),
  product_id: z.uuid(),
  reason_id: z.uuid(),
  counted_quantity: unsignedQuantitySchema,
  note: note.optional(),
});
export type AdjustToCountDto = z.infer<typeof adjustToCountSchema>;
