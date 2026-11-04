import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { AnalyticsModule } from '@modivara/analytics-api';
import { CommerceModule } from '@modivara/commerce-api';
import { CORE_PRISMA, CoreModule, coreGlobalProviders, Public } from '@modivara/core-api';
import { HospitalityModule } from '@modivara/hospitality-api';
import { IntegrationSubscribersModule } from './integration-subscribers.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(CORE_PRISMA) private readonly db: { $queryRawUnsafe(sql: string): Promise<unknown> }) {}

  /** Vivo: el proceso responde. `/health` queda como alias (demo, E2E). */
  @Public()
  @Get(['', 'live'])
  live() {
    return { status: 'ok' };
  }

  /** Listo: además la base responde. ponytail: solo PostgreSQL (los 4 esquemas viven en la misma); sumar MQTT/outbox si el piloto lo pide. */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.db.$queryRawUnsafe('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}

const hospitality = HospitalityModule.forRoot();
const commerce = CommerceModule.forRoot();
const analytics = AnalyticsModule.forRoot();

// El host solo compone los módulos de dominio (TECH-001 §5); no contiene reglas de negocio.
@Module({
  imports: [CoreModule.forRoot(), hospitality, commerce, analytics, IntegrationSubscribersModule.forDomains({ hospitality, commerce, analytics })],
  controllers: [HealthController],
  // Guards (Origin, sesión, permiso, módulo) y filtro de errores de core: valen para las rutas de todos los dominios.
  providers: [...coreGlobalProviders],
})
export class AppModule {}
