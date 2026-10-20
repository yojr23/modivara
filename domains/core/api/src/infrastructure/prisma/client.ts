import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client.js';

export type CorePrisma = PrismaClient;

/**
 * Cliente Prisma del esquema core. El esquema sale del parámetro `?schema=` de la URL (DATA-001 §1);
 * `search_path` también se fija para que el SQL crudo (locks, mantenimiento) quede en el mismo esquema.
 */
export function createCorePrisma(url: string): CorePrisma {
  const schema = new URL(url).searchParams.get('schema') ?? 'core';
  const adapter = new PrismaPg({ connectionString: url, options: `-c search_path=${schema}` }, { schema });
  return new PrismaClient({ adapter });
}
