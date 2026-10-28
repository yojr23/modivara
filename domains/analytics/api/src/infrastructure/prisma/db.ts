import type { Prisma } from './generated/client.js';
import type { AnalyticsPrisma } from './client.js';

/** Cliente o cliente transaccional: los adaptadores funcionan igual en ambos. */
export type Db = AnalyticsPrisma | Prisma.TransactionClient;
