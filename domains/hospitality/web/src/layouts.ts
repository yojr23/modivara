import {
  LAYOUTS_API_PATHS as P, layoutConflictSchema, layoutDraftResponseSchema, layoutSchema,
  type LayoutDraftResponse, type LayoutDto, type PublishLayoutBody, type SaveLayoutDraftBody,
} from '@modivara/hospitality-contracts';
import { ApiRequestError, buildPath, request } from './client.js';

/** `zoneId` null = espacio por defecto del local. */
export const layoutKeys = {
  published: (l: string) => ['hospitality', l, 'layouts', 'published'] as const,
  draft: (l: string, zoneId: string | null) => ['hospitality', l, 'layouts', 'draft', zoneId ?? 'default'] as const,
};

/** 409 al guardar/publicar: la revisión ya no es la vigente; `current` es el borrador vigente (null si ya no hay). */
export type LayoutConflict = { state: 'conflict'; current: LayoutDto | null | undefined };
export function toLayoutConflict(e: unknown): LayoutConflict | undefined {
  if (!(e instanceof ApiRequestError) || e.status !== 409) return undefined;
  const c = layoutConflictSchema.safeParse(e.body);
  return { state: 'conflict', current: c.success ? c.data.current : undefined };
}

const send = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const layoutsApi = {
  listPublished: (l: string): Promise<LayoutDto[]> => request(buildPath(P.layouts, { locationId: l }), layoutSchema.array()),
  getDraft: (l: string, zoneId: string | null): Promise<LayoutDraftResponse> =>
    request(buildPath(P.layoutDraft, { locationId: l }) + (zoneId ? `?zone_id=${encodeURIComponent(zoneId)}` : ''), layoutDraftResponseSchema),
  saveDraft: (l: string, body: SaveLayoutDraftBody): Promise<LayoutDto> => request(buildPath(P.layoutDraft, { locationId: l }), layoutSchema, send('PUT', body)),
  publish: (l: string, body: PublishLayoutBody): Promise<LayoutDto> => request(buildPath(P.layoutPublish, { locationId: l }), layoutSchema, send('POST', body)),
};
