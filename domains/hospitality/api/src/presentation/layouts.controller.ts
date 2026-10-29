import { Body, Catch, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, UseFilters, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  LAYOUTS_API_PATHS as P, layoutDraftQuerySchema, publishLayoutSchema, saveLayoutDraftSchema, type LayoutDraftResponse, type LayoutDto,
} from '@modivara/hospitality-contracts';
import { GetLayoutDraft, ListPublishedLayouts, PublishLayout, SaveLayoutDraft } from '../application/layouts.js';
import { LayoutRevisionConflictError } from '../domain/errors.js';
import type { SpaceLayout } from '../domain/layouts/space-layout.js';
import { contextOf, CurrentActor, RequireModule, RequirePermission } from './decorators.js';

const toDto = (l: SpaceLayout): LayoutDto => {
  const p = l.toProps();
  return {
    id: p.id, zone_id: p.zoneId, version: p.version, status: p.status, canvas_width: p.canvasWidth, canvas_height: p.canvasHeight,
    elements: p.elements, revision: p.revision, updated_at: p.updatedAt.toISOString(), published_at: p.publishedAt?.toISOString() ?? null,
  };
};

/** 409 con el borrador vigente (`layoutConflictSchema`): el editor lo recarga y reintenta. */
@Catch(LayoutRevisionConflictError)
export class LayoutConflictFilter implements ExceptionFilter {
  catch(error: LayoutRevisionConflictError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(c: number): { json(b: unknown): void } }>();
    res.status(409).json({ code: error.code, message: error.message, current: error.current && toDto(error.current) });
  }
}

@Controller()
@UseFilters(LayoutConflictFilter)
@RequireModule('hospitality')
export class LayoutsController {
  constructor(
    @Inject(ListPublishedLayouts) private readonly list: ListPublishedLayouts,
    @Inject(GetLayoutDraft) private readonly getDraft: GetLayoutDraft,
    @Inject(SaveLayoutDraft) private readonly save: SaveLayoutDraft,
    @Inject(PublishLayout) private readonly publish: PublishLayout,
  ) {}

  @Get(P.layouts)
  @RequirePermission('hospitality.calls.read')
  async index(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<LayoutDto[]> {
    return (await this.list.execute(contextOf(actor, locationId))).map(toDto);
  }

  @Get(P.layoutDraft)
  @RequirePermission('hospitality.tables.manage')
  async draft(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Query() rawQuery: unknown): Promise<LayoutDraftResponse> {
    const { zone_id } = layoutDraftQuerySchema.parse(rawQuery);
    const { draft, published } = await this.getDraft.execute({ ...contextOf(actor, locationId), zoneId: zone_id ?? null });
    return { draft: draft && toDto(draft), published: published && toDto(published) };
  }

  @Put(P.layoutDraft)
  @RequirePermission('hospitality.tables.manage')
  async put(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<LayoutDto> {
    const b = saveLayoutDraftSchema.parse(body);
    return toDto(
      await this.save.execute({
        ...contextOf(actor, locationId), zoneId: b.zone_id, revision: b.revision, canvasWidth: b.canvas_width, canvasHeight: b.canvas_height, elements: b.elements,
      }),
    );
  }

  @Post(P.layoutPublish)
  @HttpCode(200)
  @RequirePermission('hospitality.tables.manage')
  async post(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<LayoutDto> {
    const b = publishLayoutSchema.parse(body);
    return toDto(await this.publish.execute({ ...contextOf(actor, locationId), zoneId: b.zone_id, revision: b.revision }));
  }
}
