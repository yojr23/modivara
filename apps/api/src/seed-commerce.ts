import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommerceModule } from '@modivara/commerce-api';
import { CoreModule } from '@modivara/core-api';
import { seedCommerce } from './seed/commerce.js';

// Contexto standalone: core y commerce (CORE_DATABASE_URL y COMMERCE_DATABASE_URL), sin HTTP. Correr antes `seed:core`.
@Module({ imports: [CoreModule.forRoot({ outbox: false }), CommerceModule.forRoot({ outbox: false })] })
class SeedModule {}

const password = process.env.SEED_PASSWORD;
if (!password) {
  console.error('SEED_PASSWORD es obligatoria (la misma de seed:core).');
  process.exit(1);
}
const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
try {
  await seedCommerce(app, password);
  console.log('seed:commerce listo (bar-demo y bar-demo-pisos: motivos, «Principal» y 10 productos con stock inicial).');
} finally {
  await app.close();
}
