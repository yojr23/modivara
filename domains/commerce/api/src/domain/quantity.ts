import { formatMilli, MAX_MILLI, parseMilli } from '@modivara/commerce-contracts';
import { InvalidQuantityError, QuantityOutOfRangeError } from './errors.js';

/** Exact NUMERIC(12,3) decimal stored as integer thousandths (bigint). Immutable; never float. */
export class Quantity {
  private constructor(readonly milli: bigint) {}

  static zero(): Quantity {
    return new Quantity(0n);
  }

  static fromMilli(milli: bigint): Quantity {
    if (milli > MAX_MILLI || milli < -MAX_MILLI) {
      throw new QuantityOutOfRangeError('Quantity out of NUMERIC(12,3) range');
    }
    return new Quantity(milli);
  }

  static parse(text: string): Quantity {
    try {
      return new Quantity(parseMilli(text));
    } catch (e) {
      if (e instanceof RangeError) throw new InvalidQuantityError(`Invalid quantity: "${text}"`);
      throw e;
    }
  }

  plus(other: Quantity): Quantity {
    return Quantity.fromMilli(this.milli + other.milli);
  }
  minus(other: Quantity): Quantity {
    return Quantity.fromMilli(this.milli - other.milli);
  }
  negate(): Quantity {
    return new Quantity(-this.milli);
  }
  isZero(): boolean {
    return this.milli === 0n;
  }
  isPositive(): boolean {
    return this.milli > 0n;
  }
  isNegative(): boolean {
    return this.milli < 0n;
  }
  equals(other: Quantity): boolean {
    return this.milli === other.milli;
  }

  /** Always 3 decimals ("1.500"): stable format for events and persistence. */
  toString(): string {
    return formatMilli(this.milli);
  }
}
