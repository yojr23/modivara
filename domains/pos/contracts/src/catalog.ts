import { z } from 'zod';
import { MONEY_PATTERN, QUANTITY_PATTERN } from './decimal.js';

/**
 * Unidades de medida, no de un rubro: lo mismo sirve para un zapato, un café, un kilo de queso o una hora de servicio.
 * Solo `unit` exige cantidades enteras.
 */
export const UNITS = ['unit', 'kg', 'g', 'l', 'ml', 'm', 'h'] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof unitSchema>;

/** Cobro declarado por el operador, un solo medio por venta. No es un pago procesado ni un comprobante fiscal. */
export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const SALE_STATUSES = ['open', 'completed', 'voided'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

// ponytail: todas las monedas con 2 decimales; usar los decimales ISO 4217 de cada moneda si se vende en CLP/JPY.
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Moneda ISO 4217 inválida');
export const priceSchema = z.string().regex(MONEY_PATTERN, 'Precio inválido (máx. 12 enteros y 2 decimales)');
export const quantitySchema = z.string().regex(QUANTITY_PATTERN, 'Cantidad inválida (máx. 9 enteros y 3 decimales)');

export const NAME_MAX_LENGTH = 120;
export const SKU_MAX_LENGTH = 64;
