import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, describe, expect, it } from 'vitest';
import { CoreModule, Login } from '@modivara/core-api';
import { seedCore } from './core.js';

// F1-11: el seed se puede repetir y deja usuarios que inician sesión de verdad. Requiere db-test (esquema core migrado).
const url = 'postgresql://core_app:test@127.0.0.1:55432/modivara_test?schema=core';
@Module({ imports: [CoreModule.forRoot({ databaseUrl: url })] })
class SeedTestModule {}

// Misma contraseña que usan las demás pruebas de integración: la base de pruebas puede traer sus usuarios.
const PASSWORD = 'Secret123';
const USERS: Array<[string, string]> = [
  ['labs', 'superadmin'], ['bar-demo', 'admin'], ['bar-demo', 'barra'], ['bar-demo', 'mesero1'],
  ['bar-demo', 'inventario1'], ['bar-demo-pisos', 'admin'],
];

describe('seed:core', () => {
  it('es idempotente y los usuarios inician sesión', async () => {
    const app = await NestFactory.createApplicationContext(SeedTestModule, { logger: false });
    try {
      await seedCore(app, PASSWORD);
      await seedCore(app, PASSWORD);
      const login = app.get(Login);
      for (const [slug, username] of USERS) {
        expect((await login.execute({ slug, username, password: PASSWORD })).username).toBe(username);
      }
    } finally {
      await app.close();
    }
  });
});
