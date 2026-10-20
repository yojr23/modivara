import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from '@modivara/core-api';
import { seedCore } from './seed/core.js';

// Contexto standalone: solo core (necesita CORE_DATABASE_URL), sin HTTP ni los demás dominios.
@Module({ imports: [CoreModule.forRoot()] })
class SeedModule {}

const password = process.env.SEED_PASSWORD;
if (!password) {
  console.error('SEED_PASSWORD es obligatoria (contraseña de todos los usuarios de demo; cumple la política: 8+, mayúscula y número).');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
try {
  await seedCore(app, password);
  console.log('seed:core listo (labs, bar-demo, bar-demo-pisos).');
} finally {
  await app.close();
}
