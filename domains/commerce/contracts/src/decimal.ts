/**
 * Cantidades NUMERIC(12,3) como milésimas enteras (bigint): aritmética exacta, nunca float.
 * Única implementación: la usan los esquemas de este contrato, el dominio de commerce y analytics.
 */
export const MILLI_PER_UNIT = 1000n;
/** 12 dígitos, 3 decimales → |valor| ≤ 999 999 999.999. */
export const MAX_MILLI = 999_999_999_999n;
export const SIGNED_DECIMAL_PATTERN = /^-?\d{1,9}(\.\d{1,3})?$/;
export const UNSIGNED_DECIMAL_PATTERN = /^\d{1,9}(\.\d{1,3})?$/;

/** "1.5" → 1500n. Lanza RangeError si no cumple NUMERIC(12,3). */
export function parseMilli(value: string): bigint {
  if (!SIGNED_DECIMAL_PATTERN.test(value)) throw new RangeError(`invalid decimal: ${value}`);
  const negative = value.startsWith('-');
  const [int, frac = ''] = (negative ? value.slice(1) : value).split('.');
  const milli = BigInt(int!) * MILLI_PER_UNIT + BigInt(frac.padEnd(3, '0'));
  return negative ? -milli : milli;
}

/** 1500n → "1.500" (siempre 3 decimales: formato estable para eventos y persistencia). */
export function formatMilli(milli: bigint): string {
  const abs = milli < 0n ? -milli : milli;
  const text = `${abs / MILLI_PER_UNIT}.${String(abs % MILLI_PER_UNIT).padStart(3, '0')}`;
  return milli < 0n ? `-${text}` : text;
}
