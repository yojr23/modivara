import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PublishLayoutBody, SaveLayoutDraftBody } from '@modivara/hospitality-contracts';
import { hospitalityApi as api, toErrorState, type TableInput, type ZoneInput } from './client.js';
import { layoutKeys, layoutsApi, toLayoutConflict } from './layouts.js';

/** Claves por local: nunca se mezclan datos de dos locales. */
export const hospitalityKeys = {
  zones: (l: string) => ['hospitality', l, 'zones'] as const,
  tables: (l: string) => ['hospitality', l, 'tables'] as const,
  deviceStatus: (l: string) => ['hospitality', l, 'device-status'] as const,
  gateways: (l: string) => ['hospitality', l, 'platform', 'gateways'] as const,
  devices: (l: string) => ['hospitality', l, 'platform', 'devices'] as const,
  unknownDevices: (l: string) => ['hospitality', l, 'platform', 'unknown-devices'] as const,
};
type Key = readonly unknown[];

const retry = false as const; // un 403/409 no mejora reintentando
const inval = (qc: QueryClient, keys: Key[]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
export function mutation<V, R>(fn: (v: V) => Promise<R>, keys: (v: V) => Key[]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (_r, v) => inval(qc, keys(v)) });
}

/** Estado de UI tipado de un error de hook (`undefined` si no hay error). */
export const errorState = (e: unknown) => (e == null ? undefined : toErrorState(e));

export const useZones = (l: string) => useQuery({ queryKey: hospitalityKeys.zones(l), queryFn: () => api.listZones(l), retry });
export const useTables = (l: string) => useQuery({ queryKey: hospitalityKeys.tables(l), queryFn: () => api.listTables(l), retry });
export const useDeviceStatus = (l: string) => useQuery({ queryKey: hospitalityKeys.deviceStatus(l), queryFn: () => api.deviceStatus(l), retry });

// Las mesas muestran `zone_name`/`display_name`: cambios de zona invalidan también las mesas.
const zoneKeys = (l: string) => [hospitalityKeys.zones(l), hospitalityKeys.tables(l)];
const tableKeys = (l: string) => [hospitalityKeys.tables(l), hospitalityKeys.deviceStatus(l)];

export const useCreateZone = (l: string) => mutation((v: ZoneInput) => api.createZone(l, v), () => [hospitalityKeys.zones(l)]);
export const useUpdateZone = (l: string) =>
  mutation((v: { zoneId: string; input: Partial<ZoneInput> }) => api.updateZone(l, v.zoneId, v.input), () => zoneKeys(l));
export const useDeactivateZone = (l: string) => mutation((zoneId: string) => api.deactivateZone(l, zoneId), () => zoneKeys(l));

// Planos (ADR-003). El plano publicado se refresca con `layout.published` (RealtimeProvider); el borrador solo cambia por quien edita.
export const useLayouts = (l: string) => useQuery({ queryKey: layoutKeys.published(l), queryFn: () => layoutsApi.listPublished(l), retry });
/** Borrador + publicado de un espacio (`zoneId` null = espacio por defecto). */
export const useLayoutDraft = (l: string, zoneId: string | null) =>
  useQuery({ queryKey: layoutKeys.draft(l, zoneId), queryFn: () => layoutsApi.getDraft(l, zoneId), retry });
/** 409 (`conflict`): relee el borrador vigente, que también viene en `toLayoutConflict(error).current`. */
export function useSaveLayoutDraft(l: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SaveLayoutDraftBody) => layoutsApi.saveDraft(l, v),
    onSettled: (_r, e, v) => (e && !toLayoutConflict(e) ? undefined : qc.invalidateQueries({ queryKey: layoutKeys.draft(l, v.zone_id) })),
  });
}
export const usePublishLayout = (l: string) =>
  mutation((v: PublishLayoutBody) => layoutsApi.publish(l, v), (v) => [layoutKeys.draft(l, v.zone_id), layoutKeys.published(l)]);
/** Estado de UI del error de guardar/publicar un plano; 409 incluye el borrador vigente si vino. */
export const layoutErrorState = (e: unknown) => (e == null ? undefined : toLayoutConflict(e) ?? { state: toErrorState(e) });

export const useCreateTable =(l: string) => mutation((v: TableInput) => api.createTable(l, v), () => tableKeys(l));
export const useUpdateTable = (l: string) =>
  mutation((v: { tableId: string; input: Partial<TableInput> }) => api.updateTable(l, v.tableId, v.input), () => tableKeys(l));
export const useDeactivateTable = (l: string) => mutation((tableId: string) => api.deactivateTable(l, tableId), () => tableKeys(l));
