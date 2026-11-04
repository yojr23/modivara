import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CoreModule, coreGlobalProviders } from '@modivara/core-api';
import { HealthController } from '../app.module.js';

// QA-04: vivo ≠ listo. Con la base caída, `/health/live` sigue en 200 y `/health/ready` da 503.
async function host(databaseUrl: string) {
  @Module({ imports: [CoreModule.forRoot({ databaseUrl })], controllers: [HealthController], providers: [...coreGlobalProviders] })
  class HealthHost {}
  const app = (await Test.createTestingModule({ imports: [HealthHost] }).compile()).createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

describe('health', () => {
  it.each([
    ['postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core', 200],
    ['postgresql://core_app:test@127.0.0.1:1/modivara_test?schema=core', 503],
  ])('base %s → ready %i; live siempre 200', async (url, ready) => {
    const app = await host(url);
    try {
      expect((await request(app.getHttpServer()).get('/api/v1/health/live')).status).toBe(200);
      expect((await request(app.getHttpServer()).get('/api/v1/health')).status).toBe(200);
      const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
      expect(res.status).toBe(ready);
      // PAT-01: informa los eventos detenidos por dominio (sin afectar el estado).
      if (ready === 200) expect(res.body.outbox_failed).toEqual({ core: expect.any(Number), hospitality: expect.any(Number), commerce: expect.any(Number) });
    } finally {
      await app.close();
    }
  });
});
