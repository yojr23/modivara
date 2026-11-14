import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export type PosPrisma = PrismaClient;

/**
 * Cliente Prisma del esquema pos. El esquema sale del parámetro `?schema=` de la URL;
 * `search_path` también se fija para que el SQL crudo (bloqueos) quede en el mismo esquema.
 */
export function createPosPrisma(url: string): PosPrisma {
  const schema = new URL(url).searchParams.get('schema') ?? 'pos';
  const adapter = new PrismaPg({ connectionString: url, options: `-c search_path=${schema}` }, { schema });
  return new PrismaClient({ adapter });
}
