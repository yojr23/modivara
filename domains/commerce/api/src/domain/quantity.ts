import { InvalidQuantityError, QuantityOutOfRangeError } from './errors.js';

const SCALE = 1000n;
/** NUMERIC(12,3): 12 dígitos en total, 3 decimales → |valor| ≤ 999 999 999.999. */
const MAX_SCALED = 999_999_999_999n;
const PATTERN = /^(-?)(\d{1,9})(?:\.(\d{1,3}))?$/;

/** Decimal exacto con 3 decimales, guardado como entero ×1000 (bigint). Inmutable; nunca float. */
export class Quantity {
  private constructor(readonly scaled: bigint) {}

  static zero(): Quantity {
    return new Quantity(0n);
  }

  static fromScaled(scaled: bigint): Quantity {
    if (scaled > MAX_SCALED || scaled < -MAX_SCALED) {
      throw new QuantityOutOfRangeError('Cantidad fuera del rango NUMERIC(12,3)');
    }
    return new Quantity(scaled);
  }

  static parse(text: string): Quantity {
    const m = PATTERN.exec(text);
    if (!m) throw new InvalidQuantityError(`Cantidad inválida: "${text}"`);
    const [, sign, int, frac = ''] = m;
    const scaled = BigInt(int!) * SCALE + BigInt(frac.padEnd(3, '0'));
    return new Quantity(sign === '-' ? -scaled : scaled);
  }

  plus(other: Quantity): Quantity {
    return Quantity.fromScaled(this.scaled + other.scaled);
  }
  minus(other: Quantity): Quantity {
    return Quantity.fromScaled(this.scaled - other.scaled);
  }
  negate(): Quantity {
    return new Quantity(-this.scaled);
  }
  isZero(): boolean {
    return this.scaled === 0n;
  }
  isPositive(): boolean {
    return this.scaled > 0n;
  }
  isNegative(): boolean {
    return this.scaled < 0n;
  }
  equals(other: Quantity): boolean {
    return this.scaled === other.scaled;
  }

  /** Siempre con 3 decimales ("1.500"), formato estable para eventos y persistencia. */
  toString(): string {
    const abs = this.scaled < 0n ? -this.scaled : this.scaled;
    const frac = (abs % SCALE).toString().padStart(3, '0');
    return `${this.scaled < 0n ? '-' : ''}${abs / SCALE}.${frac}`;
  }
}
