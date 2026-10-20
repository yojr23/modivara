import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DomainExceptionFilter } from './domain-exception.filter.js';
import { ModuleEnabledGuard, PermissionGuard, SessionGuard } from './guards/index.js';
import { OriginGuard } from './origin.guard.js';

export { AuthController } from './auth.controller.js';
export { PlatformController } from './platform.controller.js';
export { UsersController } from './users.controller.js';
export { LoginRateLimiter } from './login-rate-limiter.js';
export { DomainExceptionFilter } from './domain-exception.filter.js';
export * from './guards/index.js';
export { OriginGuard } from './origin.guard.js';

/**
 * Guards y filtro globales, en este orden: Origin → Session → Permission → Module.
 * El host los registra una vez (`providers: [...coreGlobalProviders]`); toda ruta de cualquier dominio exige sesión
 * salvo `@Public()`. Requiere importar `CoreModule`, que exporta los casos de uso que usan los guards.
 */
export const coreGlobalProviders = [
  { provide: APP_GUARD, useClass: OriginGuard },
  { provide: APP_GUARD, useClass: SessionGuard },
  { provide: APP_GUARD, useClass: PermissionGuard },
  { provide: APP_GUARD, useClass: ModuleEnabledGuard },
  { provide: APP_FILTER, useClass: DomainExceptionFilter },
];
