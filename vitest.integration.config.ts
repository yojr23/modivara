import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Pruebas contra PostgreSQL real (servicio db-test). Secuenciales: comparten la base.
export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    include: ['domains/**/*.int.test.ts', 'apps/**/*.int.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globalSetup: ['./scripts/integration-setup.mjs'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
