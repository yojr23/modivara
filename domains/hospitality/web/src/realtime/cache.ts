import type { ServiceCallDto } from '@modivara/hospitality-contracts';
import type { QueryClient } from '@tanstack/react-query';
import type { CallHistoryQuery } from '../calls.js';

export const callsKeys = {
  all: (l: string) => ['hospitality', l, 'service-calls'] as const,
  active: (l: string) => ['hospitality', l, 'service-calls', 'active'] as const,
  detail: (l: string, callId: string) => ['hospitality', l, 'service-calls', 'detail', callId] as const,
  history: (l: string, q: CallHistoryQuery) => ['hospitality', l, 'service-calls', 'history', q] as const,
};

/** Agrega/actualiza por id; los `completed` salen de la lista de activos. */
export function mergeActive(list: ServiceCallDto[], call: ServiceCallDto): ServiceCallDto[] {
  if (call.status === 'completed') return list.filter((c) => c.id !== call.id);
  return list.some((c) => c.id === call.id) ? list.map((c) => (c.id === call.id ? call : c)) : [...list, call];
}

export const applyCallChange = (qc: QueryClient, l: string, call: ServiceCallDto) =>
  qc.setQueryData<ServiceCallDto[]>(callsKeys.active(l), (old) => (old && mergeActive(old, call)));
