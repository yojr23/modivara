import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { Module, type INestApplicationContext, type ModuleMetadata } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ANALYTICS_SOURCES, RebuildProjections, type RebuildSummary } from '@modivara/analytics-api';
import { CoreModule } from '@modivara/core-api';
import { EVENT_HISTORY_READERS, type EventHistoryReader } from '@modivara/core-contracts';
import { domainModules, selectedDomains, type DomainName } from './domains.js';
import { IntegrationSubscribersModule } from './integration-subscribers.module.js';

// Reconstruye las proyecciones de analytics desde el historial de outbox de las fuentes instaladas (PLAN-001 F5-08, Q-09). Uso: pnpm analytics:rebuild
// Contexto standalone sin pollers ni HTTP: así no se despachan eventos mientras se reconstruye. Compone los dominios de MODIVARA_DOMAINS,
// como la API: solo pide las variables de esos dominios y solo lee el historial de las fuentes presentes.

/** Composición del comando. Sin analytics no hay nada que reconstruir: falla antes de tocar la base. */
export function rebuildMetadata(names: readonly DomainName[] = selectedDomains()): ModuleMetadata {
  if (!names.includes('analytics')) throw new Error('analytics:rebuild necesita "analytics" en MODIVARA_DOMAINS.');
  const domains = domainModules(names, true);
  return { imports: [CoreModule.forRoot({ outbox: false }), ...domains, IntegrationSubscribersModule.forDomains(domains)] };
}

/**
 * Vacía y reconstruye solo las fuentes de `names` (las de MODIVARA_DOMAINS): los hechos de una fuente no compuesta quedan intactos,
 * porque no se podrían rehacer. Sin ninguna fuente aborta antes de tocar nada.
 */
export async function rebuildAnalytics(app: INestApplicationContext, names: readonly DomainName[] = selectedDomains()): Promise<RebuildSummary> {
  const readers = app.get<EventHistoryReader[]>(EVENT_HISTORY_READERS);
  if (!readers.length) throw new Error('analytics:rebuild: ninguna fuente con historial en MODIVARA_DOMAINS; no se vacía nada.');
  return app.get(RebuildProjections).execute(readers, ANALYTICS_SOURCES.filter((s) => names.includes(s)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let app: INestApplicationContext | undefined;
  try {
    @Module(rebuildMetadata())
    class RebuildModule {}
    app = await NestFactory.createApplicationContext(RebuildModule, { logger: ['error', 'warn'] });
    const summary = await rebuildAnalytics(app);
    console.log(`analytics:rebuild: ${summary.total} evento(s) leídos, ${summary.applied} aplicados, ${summary.duplicates} duplicados, ${summary.ignored} ignorados.`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
