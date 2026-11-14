import { MONEY_SCALE, NAME_MAX_LENGTH, QUANTITY_SCALE, type Unit, UNITS, parseScaled } from '@modivara/pos-contracts';
import { InvalidQuantityError, InvalidValueError } from './errors.js';

const MAX_PRICE = 10n ** 14n - 1n; // NUMERIC(14,2)
const MAX_QUANTITY = 10n ** 12n - 1n; // NUMERIC(12,3)

/** Texto obligatorio, recortado y acotado. */
export function requireText(label: string, value: string, max = NAME_MAX_LENGTH): string {
  const v = value.trim();
  if (v.length === 0 || v.length > max) throw new InvalidValueError(`${label} must be 1 to ${max} characters long`);
  return v;
}

/** Texto opcional: vacío o undefined → null. */
export function optionalText(label: string, value: string | null | undefined, max = NAME_MAX_LENGTH): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  return requireText(label, value, max);
}

export function requireUnit(unit: string): Unit {
  if (!(UNITS as readonly string[]).includes(unit)) throw new InvalidValueError(`Invalid unit: ${unit}`);
  return unit as Unit;
}

export function requireCurrency(currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) throw new InvalidValueError(`Invalid currency: ${currency}`);
  return currency;
}

/** Precio en centésimas (bigint). Cero se admite (cortesías, artículos de regalo). */
export function parsePrice(text: string): bigint {
  let value: bigint;
  try {
    value = parseScaled(text, MONEY_SCALE);
  } catch {
    throw new InvalidValueError(`Invalid price: "${text}"`);
  }
  if (value > MAX_PRICE) throw new InvalidValueError(`Price out of range: "${text}"`);
  return value;
}

/** Cantidad en milésimas (bigint), mayor que cero; la unidad `unit` solo admite enteros. */
export function parseQuantity(text: string, unit: Unit): bigint {
  let value: bigint;
  try {
    value = parseScaled(text, QUANTITY_SCALE);
  } catch {
    throw new InvalidQuantityError(`Invalid quantity: "${text}"`);
  }
  if (value === 0n || value > MAX_QUANTITY) throw new InvalidQuantityError(`Quantity out of range: "${text}"`);
  if (unit === 'unit' && value % 10n ** BigInt(QUANTITY_SCALE) !== 0n) {
    throw new InvalidQuantityError(`Unit "${unit}" only accepts whole quantities: "${text}"`);
  }
  return value;
}
