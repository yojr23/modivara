import { z } from 'zod';
import { movementDirectionSchema, signedQuantitySchema, unitSchema, unsignedQuantitySchema } from './catalog.js';

/**
 * API de inventario bajo `/api/v1` (PLAN-001 F4-07). Compartida por la API y el portal.
 * Lo que es por local lleva `:locationId` para que el guard de permisos verifique ESE local; los motivos son por negocio.
 */
export const COMMERCE_API_PATHS = {
  products: '/locations/:locationId/products',
  product: '/locations/:locationId/products/:productId',
  productDeactivate: '/locations/:locationId/products/:productId/deactivate',
  stockLocations: '/locations/:locationId/stock-locations',
  balances: '/locations/:locationId/stock/balances',
  movements: '/locations/:locationId/stock/movements',
  countAdjustments: '/locations/:locationId/stock/count-adjustments',
  reasons: '/commerce/movement-reasons',
  reasonDeactivate: '/commerce/movement-reasons/:reasonId/deactivate',
} as const;

/**
 * Header obligatorio en movimientos y ajustes por conteo; uuid porque la columna lo es (DATA-001 §4).
 * OPEN: header (convención HTTP, PLAN-001 F4-07) en vez del campo `idempotency_key` del cuerpo que existía en el DTO.
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z.uuid();

/** `code` de los errores de negocio que la UI distingue (cuerpo `apiErrorSchema`). */
export const COMMERCE_ERROR_CODES = {
  insufficientStock: 'insufficient_stock',
  idempotencyKeyReused: 'idempotency_key_reused',
  conflict: 'conflict',
  notFound: 'not_found',
} as const;

const iso = z.iso.datetime({ offset: true });

export const productSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  category: z.string().nullable(),
  unit: unitSchema,
  active: z.boolean(),
});
export type ProductDto = z.infer<typeof productSchema>;

export const stockLocationSchema = z.object({ id: z.uuid(), name: z.string(), is_default: z.boolean(), active: z.boolean() });
export type StockLocationDto = z.infer<typeof stockLocationSchema>;

export const movementReasonSchema = z.object({ id: z.uuid(), name: z.string(), direction: movementDirectionSchema, active: z.boolean() });
export type MovementReasonDto = z.infer<typeof movementReasonSchema>;

export const balanceSchema = z.object({
  stock_location_id: z.uuid(),
  product_id: z.uuid(),
  quantity: unsignedQuantitySchema,
  updated_at: iso,
});
export type BalanceDto = z.infer<typeof balanceSchema>;

export const movementSchema = z.object({
  id: z.uuid(),
  stock_location_id: z.uuid(),
  product_id: z.uuid(),
  direction: movementDirectionSchema,
  reason_id: z.uuid(),
  delta: signedQuantitySchema,
  balance_after: unsignedQuantitySchema,
  note: z.string().nullable(),
  actor_user_id: z.uuid(),
  occurred_at: iso,
});
export type MovementDto = z.infer<typeof movementSchema>;

/** 201 si el movimiento es nuevo; 200 si la clave ya existía y se devuelve el original (`replayed`). */
export const recordedMovementSchema = z.object({ movement: movementSchema, replayed: z.boolean() });
export type RecordedMovementDto = z.infer<typeof recordedMovementSchema>;

/** Filtros opcionales de lecturas de saldos y movimientos (query string). */
export const stockQuerySchema = z.object({
  stock_location_id: z.uuid().optional(),
  product_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type StockQueryDto = z.infer<typeof stockQuerySchema>;
