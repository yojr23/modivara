import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AnalyticsModule, RebuildProjections } from '@modivara/analytics-api';
import { CommerceModule } from '@modivara/commerce-api';
import { CoreModule } from '@modivara/core-api';
import { EVENT_HISTORY_READERS, type EventHistoryReader } from '@modivara/core-contracts';
import { HospitalityModule } from '@modivara/hospitality-api';
import { IntegrationSubscribersModule } from './integration-subscribers.module.js';

// Reconstruye las proyecciones de analytics desde el historial de outbox de hospitality y commerce (PLAN-001 F5-08, Q-09). Uso: pnpm analytics:rebuild
// Contexto standalone sin pollers ni HTTP: así no se despachan eventos mientras se reconstruye.
const hospitality = HospitalityModule.forRoot({ outbox: false, mqtt: null });
const commerce = CommerceModule.forRoot({ outbox: false });
const analytics = AnalyticsModule.forRoot();

@Module({
  imports: [CoreModule.forRoot({ outbox: false }), hospitality, commerce, analytics, IntegrationSubscribersModule.forDomains({ hospitality, commerce, analytics })],
})
class RebuildModule {}

const app = await NestFactory.createApplicationContext(RebuildModule, { logger: ['error', 'warn'] });
try {
  const summary = await app.get(RebuildProjections).execute(app.get<EventHistoryReader[]>(EVENT_HISTORY_READERS));
  console.log(`analytics:rebuild: ${summary.total} evento(s) leídos, ${summary.applied} aplicados, ${summary.duplicates} duplicados, ${summary.ignored} ignorados.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await app.close();
}
