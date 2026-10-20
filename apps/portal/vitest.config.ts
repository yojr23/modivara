import { resolve } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.config.ts';

export default mergeConfig(
  base,
  defineConfig({
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
    test: { environment: 'jsdom' },
  }),
);
