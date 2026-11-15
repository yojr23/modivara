import { Module, type DynamicModule } from '@nestjs/common';
import { ANALYTICS_EVENT_SUBSCRIBER } from '@modivara/analytics-api';
import { COMMERCE_EVENT_SUBSCRIBER } from '@modivara/commerce-api';
import { COMMERCE_EVENT_HISTORY } from '@modivara/commerce-contracts';
import { CORE_EVENT_SUBSCRIBER } from '@modivara/core-api';
import { EVENT_HISTORY_READERS, INTEGRATION_EVENT_SUBSCRIBERS } from '@modivara/core-contracts';
import { HOSPITALITY_EVENT_SUBSCRIBER } from '@modivara/hospitality-api';
import { HOSPITALITY_EVENT_HISTORY } from '@modivara/hospitality-contracts';
import { POS_REFERENCE_VALIDATORS } from '@modivara/pos-api';
import { posReferenceValidators } from './integrations/hospitality-pos.js';

// Tokens que puede aportar cada dominio. Opcionales: un host parcial (p. ej. Core + Commerce, MOD-13) solo recibe los de los módulos que compone.
const SUBSCRIBERS = [CORE_EVENT_SUBSCRIBER, HOSPITALITY_EVENT_SUBSCRIBER, COMMERCE_EVENT_SUBSCRIBER, ANALYTICS_EVENT_SUBSCRIBER];
const HISTORY_READERS = [HOSPITALITY_EVENT_HISTORY, COMMERCE_EVENT_HISTORY];

const present = (tokens: string[]) => ({
  inject: tokens.map((token) => ({ token, optional: true })),
  useFactory: (...found: unknown[]) => found.filter((x) => x !== undefined),
});

/**
 * Registra los suscriptores de cada dominio bajo el token que inyectan los pollers de outbox (core, hospitality y commerce; analytics solo consume),
 * y los lectores de historial de los emisores (EVENT_HISTORY_READERS, Q-09) que consume `analytics:rebuild`. El de core audita las acciones de plataforma.
 * También el validador de mesas de Hospitality para POS (POS_REFERENCE_VALIDATORS, POS-27); sin Hospitality en el host la lista queda vacía.
 * Global para que los módulos de dominio lo vean sin importarlo. Debe recibir los MISMOS objetos DynamicModule que importa el host
 * (así Nest los trata como una sola instancia). Cada suscriptor filtra por `handles(event_type)`.
 */
@Module({})
export class IntegrationSubscribersModule {
  static forDomains(domains: DynamicModule[]): DynamicModule {
    return {
      module: IntegrationSubscribersModule,
      global: true,
      imports: domains,
      providers: [
        { provide: INTEGRATION_EVENT_SUBSCRIBERS, ...present(SUBSCRIBERS) },
        { provide: EVENT_HISTORY_READERS, ...present(HISTORY_READERS) },
        posReferenceValidators,
      ],
      exports: [INTEGRATION_EVENT_SUBSCRIBERS, EVENT_HISTORY_READERS, POS_REFERENCE_VALIDATORS],
    };
  }
}
