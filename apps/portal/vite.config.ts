import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // "source": los paquetes del workspace se consumen desde su src/ (ver tsconfig.base.json).
  resolve: {
    conditions: ['source', ...defaultClientConditions],
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
});
