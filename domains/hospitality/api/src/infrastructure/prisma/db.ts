import type { Prisma } from './generated/client.js';
import type { HospitalityPrisma } from './client.js';

/** Cliente o cliente transaccional: los adaptadores funcionan igual en ambos. */
export type Db = HospitalityPrisma | Prisma.TransactionClient;

/** Violación de unicidad de Prisma (P2002); el dominio nunca ve errores de Prisma. */
export const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

/** Ejecuta `work` y traduce P2002 a `make()` (el error de dominio que corresponda). */
export async function mapUnique<T>(work: () => Promise<T>, make: () => Error): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (isUniqueViolation(e)) throw make();
    throw e;
  }
}
