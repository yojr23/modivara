import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommerceModule } from '@modivara/commerce-api';
import { CoreModule } from '@modivara/core-api';
import { HospitalityModule } from '@modivara/hospitality-api';
import { seedHistory } from './seed/history.js';

// Contexto standalone: core, hospitality y commerce, sin HTTP ni pollers. Correr antes seed:core, seed:hospitality y seed:commerce.
@Module({ imports: [CoreModule.forRoot({ outbox: false }), HospitalityModule.forRoot({ outbox: false }), CommerceModule.forRoot({ outbox: false })] })
class SeedModule {}

const password = process.env.SEED_PASSWORD;
if (!password) {
  console.error('SEED_PASSWORD es obligatoria (la misma de seed:core).');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
try {
  const { calls, movements } = await seedHistory(app, password);
  console.log(`seed:history listo (bar-demo: ${calls} llamados y ${movements} movimientos de stock nuevos; 0 si ya había historial).`);
} finally {
  await app.close();
}
