import { Controller, Get, Module } from '@nestjs/common';
import { AnalyticsModule } from '@modivara/analytics-api';
import { CommerceModule } from '@modivara/commerce-api';
import { CoreModule, coreGlobalProviders, Public } from '@modivara/core-api';
import { HospitalityModule } from '@modivara/hospitality-api';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok' };
  }
}

// El host solo compone los módulos de dominio (TECH-001 §5); no contiene reglas de negocio.
@Module({
  imports: [CoreModule.forRoot(), HospitalityModule, CommerceModule, AnalyticsModule],
  controllers: [HealthController],
  // Guards (Origin, sesión, permiso, módulo) y filtro de errores de core: valen para las rutas de todos los dominios.
  providers: [...coreGlobalProviders],
})
export class AppModule {}
