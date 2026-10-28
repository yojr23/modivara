import { useQuery } from '@tanstack/react-query';
import { analyticsApi as api, toErrorState, type MetricsParams } from './client.js';

/** Claves por local: nunca se mezclan datos de dos locales. */
export const analyticsKeys = {
  serviceCalls: (l: string, q: MetricsParams) => ['analytics', l, 'service-calls', q] as const,
  inventory: (l: string, q: MetricsParams) => ['analytics', l, 'inventory', q] as const,
};

const retry = false as const; // un 403/404/400 no mejora reintentando

/** Estado de UI tipado de un error de hook (`undefined` si no hay error). */
export const metricsErrorState = (e: unknown) => (e == null ? undefined : toErrorState(e));

export const useServiceCallMetrics = (locationId: string, query: MetricsParams) =>
  useQuery({ queryKey: analyticsKeys.serviceCalls(locationId, query), queryFn: () => api.serviceCallMetrics(locationId, query), retry });
export const useInventoryMetrics = (locationId: string, query: MetricsParams) =>
  useQuery({ queryKey: analyticsKeys.inventory(locationId, query), queryFn: () => api.inventoryMetrics(locationId, query), retry });
