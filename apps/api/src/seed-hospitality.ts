import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from '@modivara/core-api';
import { HospitalityModule } from '@modivara/hospitality-api';
import { seedHospitality } from './seed/hospitality.js';

// Contexto standalone: core y hospitality (CORE_DATABASE_URL y HOSPITALITY_DATABASE_URL), sin HTTP. Correr antes `seed:core`.
@Module({ imports: [CoreModule.forRoot({ outbox: false }), HospitalityModule.forRoot()] })
class SeedModule {}

const password = process.env.SEED_PASSWORD;
if (!password) {
  console.error('SEED_PASSWORD es obligatoria (la misma de seed:core).');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
try {
  // La clave del gateway sale por stdout una sola vez, solo si el seed lo crea; copiarla a SIM_GATEWAY_KEY del .env.
  await seedHospitality(app, password, (line) => console.log(line));
  console.log('seed:hospitality listo (bar-demo: 15 mesas, gateway y 15 botones; bar-demo-pisos: zonas y mesas).');
} finally {
  await app.close();
}
