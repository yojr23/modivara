// Superficie pública: módulo Nest, casos de uso, tipos de puertos, decoradores y guards/filtro globales.
// Entidades de dominio e infraestructura son internas (las pruebas importan por ruta relativa).
export { CORE_OUTBOX, CoreModule } from './core.module.js';
export * from './application/index.js';
export { coreGlobalProviders, CurrentActor, DomainExceptionFilter, Public, RequireModule, RequirePermission } from './presentation/index.js';
