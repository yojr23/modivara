import { z } from 'zod';
import { parseMilli, SIGNED_DECIMAL_PATTERN, UNSIGNED_DECIMAL_PATTERN } from './decimal.js';

/** DATA-001 §4: `commerce.unit` y `commerce.movement_direction`. */
export const UNITS = ['unit', 'bottle', 'kg', 'g', 'l', 'ml'] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof unitSchema>;

export const MOVEMENT_DIRECTIONS = ['in', 'out', 'adjust'] as const;
export const movementDirectionSchema = z.enum(MOVEMENT_DIRECTIONS);
export type MovementDirection = z.infer<typeof movementDirectionSchema>;

/** Motivos sembrados por negocio (DATA-001 §4); el admin los edita después. */
export const SEEDED_MOVEMENT_REASONS: readonly { name: string; direction: MovementDirection }[] = [
  { name: 'Compra', direction: 'in' },
  { name: 'Devolución de cliente', direction: 'in' },
  { name: 'Venta', direction: 'out' },
  { name: 'Merma', direction: 'out' },
  { name: 'Rotura', direction: 'out' },
  { name: 'Vencimiento', direction: 'out' },
  { name: 'Cortesía', direction: 'out' },
  { name: 'Consumo interno', direction: 'out' },
  { name: 'Devolución a proveedor', direction: 'out' },
  { name: 'Corrección de conteo', direction: 'adjust' },
];

// OPEN: DATA-001 no fija longitudes máximas de nombre, SKU, categoría ni nota. Valores provisionales.
export const NAME_MAX_LENGTH = 120;
export const SKU_MAX_LENGTH = 64;
export const NOTE_MAX_LENGTH = 500;

/**
 * Cantidades NUMERIC(12,3) como string decimal: hasta 9 enteros y 3 decimales.
 * Nunca number: la coma flotante no representa 0.1 + 0.2 = 0.3.
 */
export const unsignedQuantitySchema = z.string().regex(UNSIGNED_DECIMAL_PATTERN, 'Cantidad inválida (máx. 9 enteros y 3 decimales)');
export const signedQuantitySchema = z.string().regex(SIGNED_DECIMAL_PATTERN, 'Cantidad inválida (máx. 9 enteros y 3 decimales)');

export function isZeroQuantity(value: string): boolean {
  return SIGNED_DECIMAL_PATTERN.test(value) && parseMilli(value) === 0n;
}
