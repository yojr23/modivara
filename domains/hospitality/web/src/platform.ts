import { useQuery } from '@tanstack/react-query';
import { hospitalityApi } from './client.js';
import { hospitalityKeys as k, mutation } from './hooks.js';

const api = hospitalityApi.platform;
const retry = false as const;

export const useGateways = (l: string) => useQuery({ queryKey: k.gateways(l), queryFn: () => api.listGateways(l), retry });
export const useDevices = (l: string) => useQuery({ queryKey: k.devices(l), queryFn: () => api.listDevices(l), retry });
export const useUnknownDevices = (l: string) => useQuery({ queryKey: k.unknownDevices(l), queryFn: () => api.listUnknownDevices(l), retry });

export const useCreateGateway = (l: string) => mutation((v: { name: string }) => api.createGateway(l, v), () => [k.gateways(l)]);
export const useCreateDevice = (l: string) =>
  mutation((v: { code: string; model?: string }) => api.createDevice(l, v), () => [k.devices(l), k.unknownDevices(l)]);

// Asignar/desasignar cambia dispositivos, desconocidos y el "¿tiene botón?" que ve el admin.
const assignKeys = (l: string) => [k.devices(l), k.unknownDevices(l), k.deviceStatus(l)];
export const useAssignDevice = (l: string) =>
  mutation((v: { deviceId: string; tableId: string }) => api.assignDevice(l, v.deviceId, v.tableId), () => assignKeys(l));
export const useUnassignDevice = (l: string) => mutation((deviceId: string) => api.unassignDevice(l, deviceId), () => assignKeys(l));
