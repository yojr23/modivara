import { defineEvent } from '@modivara/core-contracts';
import { z } from 'zod';
import { isZeroQuantity, signedQuantitySchema, unsignedQuantitySchema } from './catalog.js';

/** Payload v1 de DATA-001 §6 (snake_case). */
export const stockEventPayloadSchema = z.object({
  movement_id: z.uuid(),
  stock_location_id: z.uuid(),
  product_id: z.uuid(),
  product_name: z.string().min(1),
  reason_id: z.uuid(),
  reason_name: z.string().min(1),
  delta: signedQuantitySchema,
  balance_after: unsignedQuantitySchema,
  occurred_at: z.iso.datetime({ offset: true }),
  actor_user_id: z.uuid(),
});
export type StockEventPayload = z.infer<typeof stockEventPayloadSchema>;

const positive = (p: StockEventPayload) => !p.delta.startsWith('-') && !isZeroQuantity(p.delta);
const negative = (p: StockEventPayload) => p.delta.startsWith('-') && !isZeroQuantity(p.delta);

export const stockReceivedV1 = defineEvent(
  'commerce.stock.received',
  1,
  stockEventPayloadSchema.refine(positive, { message: 'delta debe ser > 0' }),
);
export const stockIssuedV1 = defineEvent(
  'commerce.stock.issued',
  1,
  stockEventPayloadSchema.refine(negative, { message: 'delta debe ser < 0' }),
);
export const stockAdjustedV1 = defineEvent(
  'commerce.stock.adjusted',
  1,
  stockEventPayloadSchema.refine((p) => !isZeroQuantity(p.delta), { message: 'delta debe ser ≠ 0' }),
);

export type StockReceivedV1 = z.infer<typeof stockReceivedV1>;
export type StockIssuedV1 = z.infer<typeof stockIssuedV1>;
export type StockAdjustedV1 = z.infer<typeof stockAdjustedV1>;

export const STOCK_EVENT_TYPES = {
  in: 'commerce.stock.received',
  out: 'commerce.stock.issued',
  adjust: 'commerce.stock.adjusted',
} as const;
