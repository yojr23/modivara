import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
// OPEN: un salto de proxy (Caddy) delante de la API; sin esto `req.ip` sería siempre el de Caddy y el límite por IP del login común a todos.
app.set('trust proxy', 1);
app.use(cookieParser());
app.setGlobalPrefix('api/v1');
// Tiempo real de hospitality (Socket.IO en /api/v1/realtime, misma cookie de sesión). Caddy hace el upgrade a WebSocket sin configuración extra.
app.useWebSocketAdapter(new IoAdapter(app));
app.enableShutdownHooks();
await app.listen(Number(process.env.API_PORT ?? 3000));
