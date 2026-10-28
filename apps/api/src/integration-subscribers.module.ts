import { Module, type DynamicModule } from '@nestjs/common';
import { ANALYTICS_EVENT_SUBSCRIBER } from '@modivara/analytics-api';
import { COMMERCE_EVENT_SUBSCRIBER } from '@modivara/commerce-api';
import { COMMERCE_EVENT_HISTORY } from '@modivara/commerce-contracts';
import { EVENT_HISTORY_READERS, INTEGRATION_EVENT_SUBSCRIBERS } from '@modivara/core-contracts';
import { HOSPITALITY_EVENT_SUBSCRIBER } from '@modivara/hospitality-api';
import { HOSPITALITY_EVENT_HISTORY } from '@modivara/hospitality-contracts';

/**
 * Registra también los lectores de historial de los emisores (EVENT_HISTORY_READERS, Q-09) que consume `analytics:rebuild`.
 * Registra los suscriptores de cada dominio bajo el token que inyectan los pollers de outbox (core, hospitality y commerce; analytics solo consume).
 * Global para que los módulos de dominio lo vean sin importarlo. Debe recibir los MISMOS objetos DynamicModule que importa el host
 * (así Nest los trata como una sola instancia). Cada suscriptor filtra por `handles(event_type)`.
 */
@Module({})
export class IntegrationSubscribersModule {
  static forDomains(domains: { hospitality: DynamicModule; commerce: DynamicModule; analytics: DynamicModule }): DynamicModule {
    return {
      module: IntegrationSubscribersModule,
      global: true,
      imports: [domains.hospitality, domains.commerce, domains.analytics],
      providers: [{
        provide: INTEGRATION_EVENT_SUBSCRIBERS,
        inject: [HOSPITALITY_EVENT_SUBSCRIBER, COMMERCE_EVENT_SUBSCRIBER, ANALYTICS_EVENT_SUBSCRIBER],
        useFactory: (...subscribers: unknown[]) => subscribers,
      }, {
        provide: EVENT_HISTORY_READERS,
        inject: [HOSPITALITY_EVENT_HISTORY, COMMERCE_EVENT_HISTORY],
        useFactory: (...readers: unknown[]) => readers,
      }],
      exports: [INTEGRATION_EVENT_SUBSCRIBERS, EVENT_HISTORY_READERS],
    };
  }
}
