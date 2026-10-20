import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api/v1');
app.enableShutdownHooks();
await app.listen(Number(process.env.API_PORT ?? 3000));
