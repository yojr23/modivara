import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { toErrorState } from '../client.js';
import { callsApi, toCallConflict, type CallHistoryQuery } from '../calls.js';
import { applyCallChange, callsKeys } from './cache.js';
import { RealtimeClient, type RealtimeState, type SocketFactory } from './client.js';

const Ctx = createContext<RealtimeClient | null>(null);

/** Abre la conexión del local mientras esté montado. Sin proveedor los hooks funcionan solo por REST. */
export function RealtimeProvider({ locationId, socketFactory, children }: { locationId: string; socketFactory?: SocketFactory; children: ReactNode }) {
  const qc = useQueryClient();
  const [client, setClient] = useState<RealtimeClient | null>(null);
  useEffect(() => {
    const c = new RealtimeClient(locationId, qc, socketFactory);
    setClient(c);
    return () => { c.close(); setClient(null); };
  }, [locationId, qc, socketFactory]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
}

const idle: RealtimeState = { status: 'disconnected', gateways: undefined };
const none = () => () => {};
function useRealtimeState(): RealtimeState {
  const c = useContext(Ctx);
  return useSyncExternalStore(c ? c.subscribeState : none, c ? c.getState : () => idle);
}
export const useConnectionStatus = () => useRealtimeState().status;
/** Conectividad de botones (`gateways.status`); `undefined` hasta recibir el primer evento. */
export const useGatewaysStatus = () => useRealtimeState().gateways;

/** Llamados activos: REST + `service_call.changed` aplicado al caché por el `RealtimeProvider`. */
export const useActiveCalls = (l: string) =>
  useQuery({ queryKey: callsKeys.active(l), queryFn: () => callsApi.listActive(l), retry: false });

/** Historial paginado (más reciente primero): `fetchNextPage` sigue el cursor opaco; `data.pages` son las páginas. */
export const useCallHistory = (l: string, filters: Omit<CallHistoryQuery, 'cursor'> = {}) =>
  useInfiniteQuery({
    queryKey: callsKeys.history(l, filters),
    queryFn: ({ pageParam }) => callsApi.listHistory(l, { ...filters, ...(pageParam && { cursor: pageParam }) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: false,
  });

/** Un llamado con sus transiciones y nombres de actores (pantalla de historial). */
export const useCallDetail = (l: string, callId: string) =>
  useQuery({ queryKey: callsKeys.detail(l, callId), queryFn: () => callsApi.detail(l, callId), retry: false });

function callMutation(l: string, fn: (callId: string) => ReturnType<typeof callsApi.acknowledge>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (call) => {
      applyCallChange(qc, l, call);
      void qc.invalidateQueries({ queryKey: callsKeys.detail(l, call.id) });
    },
    onError: (e) => {
      const c = toCallConflict(e);
      if (c?.current) applyCallChange(qc, l, c.current);
      else void qc.invalidateQueries({ queryKey: callsKeys.active(l) });
    },
  });
}
export const useAcknowledgeCall = (l: string) => callMutation(l, (id) => callsApi.acknowledge(l, id));
export const useCompleteCall = (l: string) => callMutation(l, (id) => callsApi.complete(l, id));

/** Estado de UI del error de una mutación de llamados; 409 incluye el llamado vigente si vino. */
export const callErrorState = (e: unknown) => (e == null ? undefined : toCallConflict(e) ?? { state: toErrorState(e) });
