/**
 * Cantidades NUMERIC(12,3) como milésimas enteras (bigint): suma exacta sin coma flotante.
 * Entrada y salida son strings decimales (contrato).
 */
const SCALE = 1000n;

export function parseMilli(value: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(value);
  if (!m) throw new RangeError(`Cantidad decimal inválida: ${value}`);
  const units = BigInt(m[2]!) * SCALE + BigInt((m[3] ?? '').padEnd(3, '0'));
  return m[1] ? -units : units;
}

export function formatMilli(milli: bigint): string {
  const abs = milli < 0n ? -milli : milli;
  const text = `${abs / SCALE}.${String(abs % SCALE).padStart(3, '0')}`;
  return milli < 0n ? `-${text}` : text;
}
