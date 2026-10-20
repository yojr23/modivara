import { ConflictError } from '@modivara/core-contracts';
import type { Prisma } from './generated/client.js';
import type { CorePrisma } from './client.js';

/** Cliente o cliente transaccional: los adaptadores funcionan igual en ambos. */
export type Db = CorePrisma | Prisma.TransactionClient;

/** Traduce la violación de unicidad de Prisma (P2002) al error del kernel; el dominio nunca ve errores de Prisma. */
export async function mapConflicts<T>(work: () => Promise<T>, what: string): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002') {
      throw new ConflictError(`${what} already exists`);
    }
    throw e;
  }
}
