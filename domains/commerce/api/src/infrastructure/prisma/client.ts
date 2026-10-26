import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export type CommercePrisma = PrismaClient;

/**
 * Cliente Prisma del esquema commerce. El esquema sale del parámetro `?schema=` de la URL (DATA-001 §1);
 * `search_path` también se fija para que el SQL crudo (locks, upsert) quede en el mismo esquema.
 */
export function createCommercePrisma(url: string): CommercePrisma {
  const schema = new URL(url).searchParams.get('schema') ?? 'commerce';
  const adapter = new PrismaPg({ connectionString: url, options: `-c search_path=${schema}` }, { schema });
  return new PrismaClient({ adapter });
}
