import { z } from 'zod';
import {
  NAME_MAX_LENGTH,
  SALE_STATUSES,
  SKU_MAX_LENGTH,
  currencySchema,
  paymentMethodSchema,
  priceSchema,
  quantitySchema,
  unitSchema,
} from './catalog.js';

/**
 * API de POS bajo `/api/v1` (POS-001 §7). Compartida por la API y el portal.
 * Todo es por local: `:locationId` deja que el guard de permisos verifique ESE local.
 */
export const POS_API_PATHS = {
  items: '/locations/:locationId/pos/items',
  item: '/locations/:locationId/pos/items/:itemId',
  itemDeactivate: '/locations/:locationId/pos/items/:itemId/deactivate',
  settings: '/locations/:locationId/pos/settings',
  sales: '/locations/:locationId/pos/sales',
  sale: '/locations/:locationId/pos/sales/:saleId',
  saleLines: '/locations/:locationId/pos/sales/:saleId/lines',
  saleLineVoid: '/locations/:locationId/pos/sales/:saleId/lines/:lineId/void',
  saleComplete: '/locations/:locationId/pos/sales/:saleId/complete',
  saleVoid: '/locations/:locationId/pos/sales/:saleId/void',
  links: '/locations/:locationId/pos/links',
} as const;

/** Obligatorio en toda mutación de una venta (también `links`): un reintento o doble clic devuelve el mismo resultado. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z.uuid();

/** `code` de los errores de negocio que la UI distingue (cuerpo `apiErrorSchema` de core-contracts). */
export const POS_ERROR_CODES = {
  saleNotOpen: 'sale_not_open',
  emptySale: 'empty_sale',
  currencyMismatch: 'currency_mismatch',
  currencyLocked: 'currency_locked',
  invalidQuantity: 'invalid_quantity',
  invalidValue: 'invalid_value',
  inactiveEntity: 'inactive_entity',
  idempotencyKeyReused: 'idempotency_key_reused',
  conflict: 'conflict',
  notFound: 'not_found',
} as const;

const iso = z.iso.datetime({ offset: true });
const name = z.string().trim().min(1).max(NAME_MAX_LENGTH);
const sku = z.string().trim().min(1).max(SKU_MAX_LENGTH);
const category = z.string().trim().min(1).max(NAME_MAX_LENGTH);
// Identificadores de proveedor y tipo de recurso externos: genéricos, en snake_case.
const slug = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const sellableItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  category: z.string().nullable(),
  unit: unitSchema,
  price: priceSchema,
  currency: currencySchema,
  active: z.boolean(),
});
export type SellableItemDto = z.infer<typeof sellableItemSchema>;

/** La moneda la pone el local (ajustes), no el cliente. */
export const createSellableItemSchema = z.object({ name, sku: sku.optional(), category: category.optional(), unit: unitSchema, price: priceSchema });
export type CreateSellableItemDto = z.infer<typeof createSellableItemSchema>;

/** Unidad y moneda no se editan. null borra el campo. */
export const updateSellableItemSchema = z.object({
  name: name.optional(),
  sku: sku.nullable().optional(),
  category: category.nullable().optional(),
  price: priceSchema.optional(),
});
export type UpdateSellableItemDto = z.infer<typeof updateSellableItemSchema>;

export const posSettingsSchema = z.object({ currency: currencySchema });
export type PosSettingsDto = z.infer<typeof posSettingsSchema>;

export const saleLineSchema = z.object({
  id: z.uuid(),
  sellable_item_id: z.uuid(),
  sku: z.string().nullable(),
  name: z.string(),
  unit: unitSchema,
  unit_price: priceSchema,
  quantity: quantitySchema,
  line_total: priceSchema,
  added_at: iso,
  voided_at: iso.nullable(),
});
export type SaleLineDto = z.infer<typeof saleLineSchema>;

/** Largo máximo de la etiqueta de un recurso externo vinculado (`sale_external_links.label`). */
export const CONTEXT_LABEL_MAX = 93;

export const saleSchema = z.object({
  id: z.uuid(),
  currency: currencySchema,
  status: z.enum(SALE_STATUSES),
  /** Suma de líneas vigentes. */
  total: priceSchema,
  payment_method: paymentMethodSchema.nullable(),
  opened_at: iso,
  opened_by: z.uuid(),
  closed_at: iso.nullable(),
  closed_by: z.uuid().nullable(),
  /** Nombre legible del recurso externo al que se vinculó (copia al vincular); se conserva al cerrar. Null si nunca se vinculó. */
  context_label: z.string().max(CONTEXT_LABEL_MAX).nullable(),
  /** Incluye las anuladas (auditoría); la UI las muestra tachadas. */
  lines: z.array(saleLineSchema),
});
export type SaleDto = z.infer<typeof saleSchema>;

/** 201 si la mutación es nueva; 200 si la clave ya existía y se devuelve el estado actual (`replayed`). */
export const saleResultSchema = z.object({ sale: saleSchema, replayed: z.boolean() });
export type SaleResultDto = z.infer<typeof saleResultSchema>;

export const addSaleLineSchema = z.object({ sellable_item_id: z.uuid(), quantity: quantitySchema });
export type AddSaleLineDto = z.infer<typeof addSaleLineSchema>;

export const completeSaleSchema = z.object({ payment_method: paymentMethodSchema });
export type CompleteSaleDto = z.infer<typeof completeSaleSchema>;

/**
 * Abre o recupera la venta vinculada a un recurso externo; el host valida el recurso con el adaptador del proveedor.
 * Exige `Idempotency-Key`: un reintento con la misma clave devuelve la misma venta aunque ya esté cerrada.
 */
export const openLinkedSaleSchema = z.object({ provider: slug, resource_type: slug, resource_id: z.uuid() });
export type OpenLinkedSaleDto = z.infer<typeof openLinkedSaleSchema>;

/** Cursor estable `(opened_at, id)` de una venta: la página siguiente empieza justo después de ella. */
const SALE_CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const saleCursor = (s: Pick<SaleDto, 'opened_at' | 'id'>) => `${s.opened_at}_${s.id}`;
/** null si no es un cursor emitido por `saleCursor`: fecha imposible o no canónica (`toISOString`) incluida. */
export const parseSaleCursor = (c: string) => {
  const m = SALE_CURSOR.exec(c);
  const openedAt = m ? new Date(m[1]!) : null;
  return openedAt && !Number.isNaN(openedAt.getTime()) && openedAt.toISOString() === m![1] ? { openedAt, id: m![2]! } : null;
};

/** Historial: más recientes primero. */
export const saleQuerySchema = z.object({
  status: z.enum(SALE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().refine((c) => parseSaleCursor(c) !== null, 'Cursor inválido').optional(),
});
export type SaleQueryDto = z.infer<typeof saleQuerySchema>;

/** Token del `EventHistoryReader` de POS (lee su propio outbox; Q-09). */
export const POS_EVENT_HISTORY = 'POS_EVENT_HISTORY';
