import type { Prisma } from './generated/client.js';
import type { PosPrisma } from './client.js';
import { DEFAULT_CURRENCY } from '../../application/use-cases.js';
import { CurrencyMismatchError } from '../../domain/errors.js';

/** Cliente o cliente transaccional: los adaptadores funcionan igual en ambos. */
export type Db = PosPrisma | Prisma.TransactionClient;

/** Violación de unicidad de Prisma (P2002); el dominio nunca ve errores de Prisma. */
export const isUniqueViolation = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002';

/**
 * Candado de moneda por local (advisory, de transacción). Cambiar la moneda lo toma en exclusiva; crear una venta o un artículo,
 * en compartido: así el chequeo y la escritura del cambio no se intercalan con altas en la moneda vieja (sin depender de que
 * exista la fila de `location_settings`).
 */
export async function lockCurrency(tx: Db, locationId: string, mode: 'shared' | 'exclusive'): Promise<void> {
  if (mode === 'exclusive') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'pos.currency:' + locationId}, 0))`;
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'pos.currency:' + locationId}, 0))`;
}

/** Moneda vigente del local leída dentro de la transacción; sin fila, la de por defecto. Falla si no es `expected`. */
export async function assertCurrentCurrency(tx: Db, { organizationId, locationId }: { organizationId: string; locationId: string }, expected: string): Promise<void> {
  const row = await tx.locationSettings.findUnique({ where: { organizationId_locationId: { organizationId, locationId } } });
  if ((row?.currency ?? DEFAULT_CURRENCY) !== expected) throw new CurrencyMismatchError('The location currency changed; retry');
}
