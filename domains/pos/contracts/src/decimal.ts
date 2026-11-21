/**
 * Decimales exactos como enteros escalados (bigint), nunca float. POS tiene su propia implementación:
 * no depende de los contratos de otros productos (PLAN-POS-001 §1, regla 1).
 */
export const QUANTITY_SCALE = 3;
export const MONEY_SCALE = 2;
/** Cantidad NUMERIC(12,3) positiva o cero: hasta 9 enteros y 3 decimales. */
export const QUANTITY_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;
/** Importe NUMERIC(14,2) no negativo: hasta 12 enteros y 2 decimales. */
export const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** "1.5" con escala 3 → 1500n. Lanza RangeError si no es un decimal no negativo con como máximo `scale` decimales. */
export function parseScaled(value: string, scale: number): bigint {
  if (!new RegExp(`^\\d+(\\.\\d{1,${scale}})?$`).test(value)) throw new RangeError(`invalid decimal: ${value}`);
  const [int, frac = ''] = value.split('.');
  return BigInt(int!) * 10n ** BigInt(scale) + BigInt(frac.padEnd(scale, '0'));
}

/** 1500n con escala 3 → "1.500" (siempre `scale` decimales: formato estable para eventos y persistencia). */
export function formatScaled(value: bigint, scale: number): string {
  if (value < 0n) throw new RangeError(`negative decimal: ${value}`);
  const unit = 10n ** BigInt(scale);
  return `${value / unit}.${String(value % unit).padStart(scale, '0')}`;
}

/** Precio (escala 2) × cantidad (escala 3), redondeado a la mitad hacia arriba a escala 2. */
export function multiplyMoney(price: bigint, quantity: bigint): bigint {
  const unit = 10n ** BigInt(QUANTITY_SCALE);
  return (price * quantity + unit / 2n) / unit;
}
