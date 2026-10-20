import { NAME_MAX_LENGTH } from '@modivara/commerce-contracts';
import { InvalidValueError } from './errors.js';

/** Texto obligatorio, recortado y acotado. */
export function requireText(label: string, value: string, max = NAME_MAX_LENGTH): string {
  const v = value.trim();
  if (v.length === 0 || v.length > max) throw new InvalidValueError(`${label} debe tener entre 1 y ${max} caracteres`);
  return v;
}

/** Texto opcional: vacío o undefined → null. */
export function optionalText(label: string, value: string | null | undefined, max = NAME_MAX_LENGTH): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  return requireText(label, value, max);
}
