import { defaultClientConditions, defaultServerConditions } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

// "source" resuelve los paquetes del workspace a su src/ sin compilarlos antes.
// Las pruebas *.int.test.ts necesitan PostgreSQL: corren con `pnpm test:integration`.
export default defineConfig({
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: { exclude: [...configDefaults.exclude, '**/*.int.test.ts'] },
});
