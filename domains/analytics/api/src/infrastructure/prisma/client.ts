import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export type AnalyticsPrisma = PrismaClient;

/**
 * Cliente Prisma del esquema analytics. El esquema sale del parámetro `?schema=` de la URL (DATA-001 §1);
 * `search_path` también se fija para que el SQL crudo quede en el mismo esquema.
 */
export function createAnalyticsPrisma(url: string): AnalyticsPrisma {
  const schema = new URL(url).searchParams.get('schema') ?? 'analytics';
  const adapter = new PrismaPg({ connectionString: url, options: `-c search_path=${schema}` }, { schema });
  return new PrismaClient({ adapter });
}
