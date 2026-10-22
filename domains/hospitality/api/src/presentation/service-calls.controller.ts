import { Catch, Controller, Get, HttpCode, Inject, Param, Post, Query, UseFilters, type ArgumentsHost, type ExceptionFilter, Headers } from '@nestjs/common';
import { CORE_ACCESS_PORT, NotFoundError, type CoreAccessPort, type RequestActor } from '@modivara/core-contracts';
import { CALLS_API_PATHS as P, listServiceCallsQuerySchema, type ServiceCallDto, type ServiceCallPage } from '@modivara/hospitality-contracts';
import { AcknowledgeCall } from '../application/acknowledge-call.js';
import { CallViews } from '../application/call-view.js';
import { CompleteCall } from '../application/complete-call.js';
import { ListServiceCalls } from '../application/list-service-calls.js';
import { ConcurrencyConflictError } from '../domain/errors.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';

/** 409 con el estado vigente (`callConflictSchema`): otro usuario ya cambió el llamado. */
@Catch(ConcurrencyConflictError)
export class CallConflictFilter implements ExceptionFilter {
  constructor(@Inject(CallViews) private readonly views: CallViews) {}

  async catch(error: ConcurrencyConflictError, host: ArgumentsHost): Promise<void> {
    const res = host.switchToHttp().getResponse<{ status(c: number): { json(b: unknown): void } }>();
    const current = error.current ? await this.views.one(error.current) : undefined;
    res.status(409).json({ code: error.code, message: error.message, ...(current && { current }) });
  }
}

@Controller()
@UseFilters(CallConflictFilter)
@RequireModule('hospitality')
export class ServiceCallsController {
  constructor(
    @Inject(CORE_ACCESS_PORT) private readonly core: CoreAccessPort,
    @Inject(ListServiceCalls) private readonly list: ListServiceCalls,
    @Inject(AcknowledgeCall) private readonly acknowledge: AcknowledgeCall,
    @Inject(CompleteCall) private readonly complete: CompleteCall,
    @Inject(CallViews) private readonly views: CallViews,
  ) {}

  @Get(P.serviceCalls)
  @RequirePermission('hospitality.calls.read')
  async index(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() rawQuery: unknown): Promise<ServiceCallPage> {
    const q = listServiceCallsQuerySchema.parse(rawQuery);
    const ctx = contextOf(actor, locationId);
    // Los permisos del actor en ESTE local alimentan `canSeeCall` (el guard ya comprobó el permiso; aquí se necesita el conjunto).
    const permissions = await this.core.permissionsAt(actor, ctx.locationId, 'hospitality');
    if (!permissions) throw new NotFoundError('location');
    const page = await this.list.execute({
      ...ctx,
      permissions,
      status: q.status,
      limit: q.limit,
      ...(q.table_id && { tableId: q.table_id }),
      ...(q.from && { from: new Date(q.from) }),
      ...(q.to && { to: new Date(q.to) }),
      ...(q.cursor && { cursor: q.cursor }),
    });
    return { items: page.items, next_cursor: page.nextCursor };
  }

  // OPEN: almacenamiento de `Idempotency-Key` (DATA-001 solo la define para movimientos de commerce). Hoy se acepta el header y la
  // idempotencia es natural: el mismo actor repitiendo la acción sobre un llamado ya en el estado resultante recibe 200 con el estado vigente.
  @Post(P.acknowledge)
  @HttpCode(200)
  @RequirePermission('hospitality.calls.acknowledge')
  async ack(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('callId') callId: string,
    @Headers('idempotency-key') _idempotencyKey?: string,
  ): Promise<ServiceCallDto> {
    return this.views.one(await this.acknowledge.execute({ ...contextOf(actor, locationId), callId: idOf(callId) }));
  }

  @Post(P.complete)
  @HttpCode(200)
  @RequirePermission('hospitality.calls.complete')
  async finish(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('callId') callId: string,
    @Headers('idempotency-key') _idempotencyKey?: string,
  ): Promise<ServiceCallDto> {
    return this.views.one(await this.complete.execute({ ...contextOf(actor, locationId), callId: idOf(callId) }));
  }
}
