import { defineConfig } from 'prisma/config';

// Un cliente y una tabla de migraciones por dominio; la URL apunta al esquema "analytics" (?schema=analytics).
export default defineConfig({
  schema: 'src/infrastructure/prisma/schema.prisma',
  migrations: { path: 'src/infrastructure/prisma/migrations' },
  datasource: { url: process.env.ANALYTICS_DATABASE_URL },
});
