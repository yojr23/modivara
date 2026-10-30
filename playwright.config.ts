import { defineConfig } from '@playwright/test';
import { BASE_URL } from './e2e/support/env';

// E2E contra el stack de Docker ya sembrado (`docker compose up --build -d` + `pnpm seed`); ver e2e/README.md.
// ponytail: un solo worker. Las pruebas comparten la base de demo, y una reinicia la API; con datos aislados por prueba se puede paralelizar.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  outputDir: 'e2e/results',
  use: {
    baseURL: BASE_URL,
    channel: 'chrome', // el Chrome instalado: no hace falta `playwright install`
    viewport: { width: 1366, height: 860 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
