import { Module } from '@nestjs/common';

// Aún sin providers: no hay adaptadores de persistencia (Prisma espera la revisión de DATA-001).
// Cuando existan, aquí se ligan los puertos (repositorios, StockLedger, CoreAccessPort) con sus adaptadores
// y se registran los casos de uso. No se inventan tokens antes de tener qué ligar.
@Module({})
export class CommerceModule {}
