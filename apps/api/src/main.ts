import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
// OPEN: un salto de proxy (Caddy) delante de la API; sin esto `req.ip` sería siempre el de Caddy y el límite por IP del login común a todos.
app.set('trust proxy', 1);
app.use(cookieParser());
app.setGlobalPrefix('api/v1');
app.enableShutdownHooks();
await app.listen(Number(process.env.API_PORT ?? 3000));
