import { Module, type DynamicModule } from '@nestjs/common';
import { COMMERCE_EVENT_SUBSCRIBER } from '@modivara/commerce-api';
import { INTEGRATION_EVENT_SUBSCRIBERS } from '@modivara/core-contracts';
import { HOSPITALITY_EVENT_SUBSCRIBER } from '@modivara/hospitality-api';

/**
 * Registra los suscriptores de cada dominio bajo el token que inyectan los pollers de outbox (core, hospitality y commerce).
 * Global para que los módulos de dominio lo vean sin importarlo. Debe recibir los MISMOS objetos DynamicModule que importa el host
 * (así Nest los trata como una sola instancia). Cada suscriptor filtra por `handles(event_type)`.
 */
@Module({})
export class IntegrationSubscribersModule {
  static forDomains(domains: { hospitality: DynamicModule; commerce: DynamicModule }): DynamicModule {
    return {
      module: IntegrationSubscribersModule,
      global: true,
      imports: [domains.hospitality, domains.commerce],
      providers: [{
        provide: INTEGRATION_EVENT_SUBSCRIBERS,
        inject: [HOSPITALITY_EVENT_SUBSCRIBER, COMMERCE_EVENT_SUBSCRIBER],
        useFactory: (...subscribers: unknown[]) => subscribers,
      }],
      exports: [INTEGRATION_EVENT_SUBSCRIBERS],
    };
  }
}
