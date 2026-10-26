import 'reflect-metadata';
import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommerceModule } from '@modivara/commerce-api';
import { CoreModule } from '@modivara/core-api';
import { retryFailed, type OutboxSql } from '@modivara/core-contracts';
import { HospitalityModule } from '@modivara/hospitality-api';

// Reintento manual (tope de 10 intentos del poller): libera los eventos con `failed_at` de un outbox. Uso: pnpm outbox:retry <core|hospitality|commerce> [event_id]
// Contexto standalone sin pollers ni HTTP; requiere la URL de base de datos del dominio (y la de core para los demás dominios).
const DOMAINS: Record<string, { prisma: string; modules: DynamicModule[] }> = {
  core: { prisma: 'CORE_PRISMA', modules: [CoreModule.forRoot({ outbox: false })] },
  hospitality: { prisma: 'HOSPITALITY_PRISMA', modules: [CoreModule.forRoot({ outbox: false }), HospitalityModule.forRoot({ outbox: false, mqtt: null })] },
  commerce: { prisma: 'COMMERCE_PRISMA', modules: [CoreModule.forRoot({ outbox: false }), CommerceModule.forRoot({ outbox: false })] },
};

const [domain, eventId] = process.argv.slice(2);
const target = domain ? DOMAINS[domain] : undefined;
if (!target || (eventId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId))) {
  console.error('Uso: pnpm outbox:retry <core|hospitality|commerce> [event_id]');
  process.exit(1);
}

@Module({ imports: target.modules })
class RetryModule {}

const app = await NestFactory.createApplicationContext(RetryModule, { logger: ['error', 'warn'] });
try {
  const released = await retryFailed(app.get<OutboxSql>(target.prisma, { strict: false }), eventId);
  console.log(`outbox:retry ${domain}: ${released} evento(s) liberado(s)${eventId ? ` (${eventId})` : ''}.`);
} finally {
  await app.close();
}
