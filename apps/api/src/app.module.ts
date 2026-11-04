import { Controller, Get, Inject, Logger, Module, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AnalyticsModule } from '@modivara/analytics-api';
import { COMMERCE_OUTBOX, CommerceModule } from '@modivara/commerce-api';
import { CORE_OUTBOX, CORE_PRISMA, CoreModule, coreGlobalProviders, Public } from '@modivara/core-api';
import type { OutboxPoller } from '@modivara/core-contracts';
import { HOSPITALITY_OUTBOX, HospitalityModule } from '@modivara/hospitality-api';
import { IntegrationSubscribersModule } from './integration-subscribers.module.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(CORE_PRISMA) private readonly db: { $queryRawUnsafe(sql: string): Promise<unknown> },
    @Optional() @Inject(CORE_OUTBOX) private readonly coreOutbox?: OutboxPoller,
    @Optional() @Inject(HOSPITALITY_OUTBOX) private readonly hospitalityOutbox?: OutboxPoller,
    @Optional() @Inject(COMMERCE_OUTBOX) private readonly commerceOutbox?: OutboxPoller,
  ) {}

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
    const failed = await this.failedEvents();
    if (Object.values(failed).some((n) => n)) this.logger.warn(JSON.stringify({ event: 'outbox.failed_pending', ...failed }));
    return { status: 'ok', database: 'up' };
  }

  /**
   * Eventos con `failed_at` por dominio (PAT-01). Informativo: NO pone ready en 503, porque un evento detenido no impide atender
   * peticiones y sacar la instancia del balanceador no lo arregla; se actúa con la alerta sobre los logs `outbox.event_failed`
   * y `outbox.failed_pending` (cada sonda mientras queden), y se libera con `pnpm outbox:retry`. No va en la respuesta: la sonda
   * es pública (Caddy expone /api/*) y el estado interno no se publica. Si el recuento falla devuelve null (no tumba la sonda).
   */
  private async failedEvents(): Promise<Record<string, number | null>> {
    const pollers = { core: this.coreOutbox, hospitality: this.hospitalityOutbox, commerce: this.commerceOutbox };
    const entries = await Promise.all(
      Object.entries(pollers).flatMap(([name, p]) => (p ? [p.countFailed().catch(() => null).then((n) => [name, n] as const)] : [])),
    );
    return Object.fromEntries(entries);
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
