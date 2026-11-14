import type { Prisma } from './generated/client.js';
import type { PosPrisma } from './client.js';

/** Cliente o cliente transaccional: los adaptadores funcionan igual en ambos. */
export type Db = PosPrisma | Prisma.TransactionClient;

/** Violación de unicidad de Prisma (P2002); el dominio nunca ve errores de Prisma. */
export const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';
