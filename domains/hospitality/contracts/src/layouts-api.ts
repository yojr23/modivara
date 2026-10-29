import { z } from 'zod';

/** API de planos de espacios bajo `/api/v1` (ADR-003). Un espacio = una zona; `zone_id` null = el espacio por defecto del local. */
export const LAYOUTS_API_PATHS = {
  /** Planos publicados de todo el local (tablero). */
  layouts: '/locations/:locationId/layouts',
  /** GET `?zone_id=` (borrador + publicado del espacio) y PUT (guardar borrador). */
  layoutDraft: '/locations/:locationId/layouts/draft',
  layoutPublish: '/locations/:locationId/layouts/publish',
} as const;

export const LAYOUT_STATUSES = ['draft', 'published', 'archived'] as const;
export const LAYOUT_TABLE_SHAPES = ['round', 'square', 'rect'] as const;
export const LAYOUT_MAX_ELEMENTS = 500;
export const LAYOUT_MAX_CANVAS = 10_000;
export const LAYOUT_LABEL_MAX = 60;

const num = z.number();
const placed = { id: z.uuid(), x: num, y: num, rotation: num.gte(0).lt(360) };
const sized = { ...placed, width: num.positive(), height: num.positive() };

/** Geometría en unidades del lienzo (no metros). Las superposiciones no se validan: la UI advierte. */
export const layoutElementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('table'), table_id: z.uuid(), shape: z.enum(LAYOUT_TABLE_SHAPES), ...sized }),
  z.object({ type: z.literal('wall'), ...sized }),
  z.object({ type: z.literal('door'), ...sized }),
  z.object({ type: z.literal('bar'), ...sized }),
  z.object({ type: z.literal('label'), text: z.string().max(LAYOUT_LABEL_MAX), ...placed }),
]);
export type LayoutElement = z.infer<typeof layoutElementSchema>;

const canvas = z.number().int().min(1).max(LAYOUT_MAX_CANVAS);

/** `revision` 0 = crear (no hay borrador); si no, debe ser la revisión vigente. */
export const saveLayoutDraftSchema = z.object({
  zone_id: z.uuid().nullable(),
  revision: z.number().int().min(0),
  canvas_width: canvas,
  canvas_height: canvas,
  elements: z.array(layoutElementSchema).max(LAYOUT_MAX_ELEMENTS),
});
export const publishLayoutSchema = z.object({ zone_id: z.uuid().nullable(), revision: z.number().int().min(1) });
/** Sin `zone_id` = espacio por defecto. */
export const layoutDraftQuerySchema = z.object({ zone_id: z.uuid().optional() });

export const layoutSchema = z.object({
  id: z.uuid(),
  zone_id: z.uuid().nullable(),
  /** 0 mientras es borrador. */
  version: z.number().int().min(0),
  status: z.enum(LAYOUT_STATUSES),
  canvas_width: z.number().int(),
  canvas_height: z.number().int(),
  elements: z.array(layoutElementSchema),
  revision: z.number().int().min(1),
  updated_at: z.iso.datetime({ offset: true }),
  published_at: z.iso.datetime({ offset: true }).nullable(),
});
export const layoutDraftResponseSchema = z.object({ draft: layoutSchema.nullable(), published: layoutSchema.nullable() });
/** 409: la revisión enviada no es la vigente; `current` es el borrador vigente (null si no hay). */
export const layoutConflictSchema = z.object({ code: z.literal('revision_conflict'), message: z.string().optional(), current: layoutSchema.nullable() });
/** Aviso a la sala del local tras publicar (los tableros releen `GET layouts`). */
export const layoutPublishedSchema = z.object({ location_id: z.uuid(), zone_id: z.uuid().nullable(), version: z.number().int().min(1) });

export type LayoutDto = z.infer<typeof layoutSchema>;
export type LayoutDraftResponse = z.infer<typeof layoutDraftResponseSchema>;
export type SaveLayoutDraftBody = z.infer<typeof saveLayoutDraftSchema>;
export type PublishLayoutBody = z.infer<typeof publishLayoutSchema>;
