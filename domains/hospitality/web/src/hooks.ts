import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { hospitalityApi as api, toErrorState, type TableInput, type ZoneInput } from './client.js';

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

export const useCreateTable = (l: string) => mutation((v: TableInput) => api.createTable(l, v), () => tableKeys(l));
export const useUpdateTable = (l: string) =>
  mutation((v: { tableId: string; input: Partial<TableInput> }) => api.updateTable(l, v.tableId, v.input), () => tableKeys(l));
export const useDeactivateTable = (l: string) => mutation((tableId: string) => api.deactivateTable(l, tableId), () => tableKeys(l));
